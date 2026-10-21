import { createBrowserClient } from "@supabase/ssr";
import {
  applyCommand,
  tableNames,
  type WorkspaceData,
  type Command,
  type Row,
} from "./domain";
import { sampleData } from "./sample";

const databaseName = "cedar-olive-sample-v1";
function openDemo(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Browser storage is unavailable. Enable site storage to use sample mode.",
        ),
      );
  });
}
async function demoRead() {
  const db = await openDemo();
  try {
    return await new Promise<WorkspaceData | undefined>((resolve, reject) => {
      const req = db
        .transaction("workspace")
        .objectStore("workspace")
        .get("state");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
async function demoWrite(data: WorkspaceData) {
  const db = await openDemo();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(data, "state");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error(
      "Connect Supabase in environment settings to open a live workspace. Sample mode is available separately.",
    );
  return createBrowserClient(url, key);
}
export async function loadWorkspace(demo: boolean): Promise<WorkspaceData> {
  if (demo) {
    if (!navigator.locks)
      throw new Error(
        "Sample mode requires a browser supporting Web Locks and IndexedDB.",
      );
    return navigator.locks.request(databaseName, async () => {
      const existing = await demoRead();
      const data = existing
        ? applyCommand(existing, { type: "bootstrap", values: {} })
        : sampleData();
      await demoWrite(data);
      return data;
    });
  }
  const db = client();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) throw new Error("Sign in to open your live workspace.");
  const memberships = await db
    .from("memberships")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at");
  if (memberships.error) throw new Error(memberships.error.message);
  const wanted = new URLSearchParams(window.location.search).get("org");
  const membership =
    memberships.data?.find((m) => m.organization_id === wanted) ??
    memberships.data?.[0];
  if (!membership) {
    window.location.assign("/setup");
    throw new Error("Organization setup required.");
  }
  const org = await db
    .from("organizations")
    .select("*")
    .eq("id", membership.organization_id)
    .single();
  if (org.error) throw new Error(org.error.message);
  // Page through Supabase's API limit; never silently truncate financial totals.
  const entries = await Promise.all(
    tableNames.map(async (table) => {
      let rows: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const result = await db
          .from(table)
          .select("*")
          .eq("organization_id", membership.organization_id)
          .order("created_at")
          .order("id")
          .range(from, from + 999);
        if (result.error)
          throw new Error(
            `${table}: ${result.error.message}. Apply all database migrations.`,
          );
        rows = rows.concat(result.data as Row[]);
        if (result.data.length < 1000) break;
      }
      return [table, rows] as const;
    }),
  );
  const members = await db.rpc("organization_members", {
    org: membership.organization_id,
  });
  if (members.error) throw new Error(members.error.message);
  const organizations = await db.from("organizations").select("id,name");
  return {
    workspaces: (organizations.data ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      role:
        memberships.data?.find((m) => m.organization_id === o.id)?.role ??
        "viewer",
    })),
    organization: org.data,
    role: membership.role,
    tables: { ...Object.fromEntries(entries), users: members.data ?? [] },
  };
}
export async function runCommand(
  demo: boolean,
  data: WorkspaceData,
  command: Command,
): Promise<WorkspaceData> {
  if (demo) {
    // Serialize read/validate/write across tabs, so credit cannot be spent twice.
    if (!navigator.locks)
      throw new Error(
        "Sample editing requires a browser supporting Web Locks.",
      );
    return navigator.locks.request(databaseName, async () => {
      const current = await demoRead();
      const next = applyCommand(current ?? data, command);
      await demoWrite(next);
      return next;
    });
  }
  const db = client(),
    v = command.values,
    org = data.organization.id;
  let result;
  switch (command.type) {
    case "payment_status":
      result = await db.rpc("resolve_pending_payment", v);
      break;
    case "invite":
      result = await db.rpc("invite_member", { org, ...v });
      break;
    case "member_role":
      result = await db.rpc("change_member_role", { org, ...v });
      break;
    case "automation_status":
      result = await db.rpc("toggle_automation", v);
      break;
    case "account":
      result = await db.rpc("create_account", { org, ...v });
      break;
    case "journal":
      result = await db.rpc("post_manual_journal", { org, ...v });
      break;
    case "recognize":
      result = await db.rpc("recognize_pledge", v);
      break;
    case "deposit":
      result = await db.rpc("deposit_payments", { org, ...v });
      break;
    case "bill":
      result = await db.rpc("create_bill", { org, ...v });
      break;
    case "pay_bill":
      result = await db.rpc("pay_bill", v);
      break;
    case "bank_import":
      result = await db.rpc("import_bank_rows", { org, ...v });
      break;
    case "bank_match":
      result = await db.rpc("match_bank_transaction", v);
      break;
    case "bank_create":
      result = await db.rpc("create_bank_entry", v);
      break;
    case "reconcile":
      result = await db.rpc("reconcile_bank", { org, ...v });
      break;
    case "bootstrap":
      throw new Error("Bootstrap is only available in sample mode.");
    case "donor_update":
      result = await db.rpc("update_donor", { org, ...v });
      break;
    case "organization_update":
      result = await db.rpc("update_organization", { org, ...v });
      break;
    case "task_status":
      result = await db.rpc("set_task_status", v);
      break;
    case "insert":
      result = await db
        .from(command.table!)
        .insert({ ...v, organization_id: org });
      break;
    case "matbia_demo_prepare":
    case "matbia_demo_finish":
      throw new Error(
        "Matbia simulation is available only in the sample workspace.",
      );
    case "cash_void":
      result = await db.rpc("void_cash_payment", v);
      break;
    case "transaction_pledge":
      result = await db.rpc("record_transaction_pledge", { org, details: v });
      break;
    case "transaction_setup":
      result = await db.rpc("ensure_transaction_setup", { org });
      break;
    case "transaction_payment":
      result = await db.rpc("record_transaction_payment", { org, details: v });
      break;
    case "donation_payment":
      result = await db.rpc("record_donation_payment", { org, details: v });
      break;
    case "donation_edit":
      result = await db.rpc("edit_donation_record", {
        org,
        kind: v.kind,
        record_id: v.record_id,
        attributes: v.attributes,
      });
      break;
    case "pledge_void":
      result = await db.rpc("void_pledge", { org, pledge: v.pledge });
      break;
    case "payment":
      result = await db.rpc("record_payment", {
        org,
        donor: v.donor_id,
        amount: v.amount_minor,
        payment_date: v.paid_on,
        payment_method: v.method,
        payment_status: v.status,
        payment_reference: v.reference,
        collector_name: v.collector ?? "",
        request_key: v.idempotency_key,
        allocations: v.allocations ?? [],
        installment: v.installment ?? null,
      });
      break;
    case "batch":
      result = await db.rpc("record_payment_batch", {
        org,
        entries: v.entries,
      });
      break;
    case "allocate":
      result = await db.rpc("allocate_payment", v);
      break;
    case "schedule":
      result = await db.rpc("create_schedule", { org, ...v });
      break;
    case "schedule_status":
      result = await db.rpc("change_schedule", v);
      break;
    case "receipt":
      result = await db.rpc("issue_receipt", v);
      break;
  }
  if (result.error) throw new Error(result.error.message);
  const next = await loadWorkspace(false);
  if (command.type === "invite") next.inviteToken = String(result.data);
  return next;
}
export async function resetDemo() {
  await navigator.locks.request(databaseName, async () => {
    await demoWrite(sampleData());
  });
  return loadWorkspace(true);
}

export async function uploadAttachment(
  demo: boolean,
  data: WorkspaceData,
  donor: string,
  file: File,
) {
  if (
    !["application/pdf", "image/png", "image/jpeg", "text/plain"].includes(
      file.type,
    ) ||
    file.size < 1 ||
    file.size > 5242880
  )
    throw new Error("Choose a PDF, PNG, JPEG, or text file up to 5 MB.");
  const storage_path = `${data.organization.id}/${donor}/${crypto.randomUUID()}`;
  const values: Record<string, unknown> = {
    donor_id: donor,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    storage_path,
  };
  if (demo) {
    values.data_url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () =>
        reject(new Error("Unable to read the attachment."));
      reader.readAsDataURL(file);
    });
  } else {
    const result = await client()
      .storage.from("donor-attachments")
      .upload(storage_path, file, { contentType: file.type, upsert: false });
    if (result.error) throw new Error(result.error.message);
  }
  try {
    return await runCommand(demo, data, {
      type: "insert",
      table: "attachments",
      values,
    });
  } catch (e) {
    if (!demo)
      await client().storage.from("donor-attachments").remove([storage_path]);
    throw e;
  }
}
export async function attachmentUrl(demo: boolean, row: Row) {
  if (demo) {
    const response = await fetch(String(row.data_url));
    return URL.createObjectURL(await response.blob());
  }
  const result = await client()
    .storage.from("donor-attachments")
    .createSignedUrl(String(row.storage_path), 60);
  if (result.error) throw new Error(result.error.message);
  return result.data.signedUrl;
}

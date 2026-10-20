export type Row = {
  id: string;
  organization_id?: string;
  [key: string]: unknown;
};
export type WorkspaceData = {
  organization: Row;
  role: string;
  tables: Record<string, Row[]>;
  workspaces?: { id: string; name: string; role: string }[];
  inviteToken?: string;
};
export const tableNames = [
  "donors",
  "campaigns",
  "pledges",
  "payments",
  "payment_allocations",
  "schedules",
  "installments",
  "receipts",
  "funds",
  "fundraisers",
  "donor_accounts",
  "donor_lists",
  "list_members",
  "events",
  "sponsorships",
  "tasks",
  "activities",
  "attachments",
  "accounts",
  "journal_entries",
  "journal_lines",
  "pledge_recognitions",
  "vendors",
  "bills",
  "bill_payments",
  "bank_transactions",
  "reconciliations",
  "reconciliation_items",
  "import_runs",
  "custom_field_definitions",
  "invitations",
  "automation_rules",
  "devices",
  "gateway_accounts",
  "document_templates",
  "notification_preferences",
  "job_logs",
  "webhook_logs",
] as const;
export type Command = {
  type:
    | "insert"
    | "payment"
    | "donation_payment"
    | "donation_edit"
    | "pledge_void"
    | "batch"
    | "allocate"
    | "schedule"
    | "schedule_status"
    | "receipt"
    | "donor_update"
    | "organization_update"
    | "task_status"
    | "bootstrap"
    | "account"
    | "journal"
    | "recognize"
    | "deposit"
    | "bill"
    | "pay_bill"
    | "bank_import"
    | "bank_match"
    | "bank_create"
    | "reconcile"
    | "invite"
    | "member_role"
    | "automation_status"
    | "payment_status";
  table?: string;
  values: Record<string, unknown>;
};
export const currency = (minor: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(minor || 0) / 100,
  );
export const sum = (rows: Row[], key: string) =>
  rows.reduce((n, r) => n + Number(r[key] || 0), 0);
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function cents(value: unknown) {
  const raw = String(value);
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw))
    throw new Error("Enter an amount with at most two decimals.");
  const [whole, part = ""] = raw.split(".");
  const amount = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new Error("Amount must be positive.");
  return amount;
}
export function dateValue(value: unknown) {
  const s = String(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw new Error("Enter a valid date.");
  return s;
}
export function paid(data: WorkspaceData, pledge: string) {
  return sum(
    data.tables.payment_allocations.filter((a) => a.pledge_id === pledge),
    "amount_minor",
  );
}
export function scheduled(data: WorkspaceData, pledge: string) {
  const plans = data.tables.schedules
    .filter(
      (s) =>
        s.pledge_id === pledge &&
        ["active", "paused"].includes(String(s.status)),
    )
    .map((s) => s.id);
  return sum(
    data.tables.installments.filter(
      (i) => plans.includes(String(i.schedule_id)) && !i.payment_id,
    ),
    "amount_minor",
  );
}
export function balance(data: WorkspaceData, pledge: Row) {
  return pledge.voided_at
    ? 0
    : Number(pledge.amount_minor) - paid(data, pledge.id);
}
export function credit(data: WorkspaceData, payment: Row) {
  return payment.status === "processed"
    ? Number(payment.amount_minor) -
        sum(
          data.tables.payment_allocations.filter(
            (a) => a.payment_id === payment.id,
          ),
          "amount_minor",
        )
    : 0;
}
export function donorTotals(data: WorkspaceData, donor: string) {
  const pledges = data.tables.pledges.filter(
    (p) => p.donor_id === donor && !p.voided_at,
  );
  const payments = data.tables.payments.filter(
    (p) => p.donor_id === donor && p.status === "processed",
  );
  return {
    pledged: sum(pledges, "amount_minor"),
    paid: sum(payments, "amount_minor"),
    scheduled: pledges.reduce((n, p) => n + scheduled(data, p.id), 0),
    open: pledges.reduce((n, p) => n + balance(data, p), 0),
    credit: payments.reduce((n, p) => n + credit(data, p), 0),
  };
}
function required(value: unknown) {
  const s = String(value ?? "").trim();
  if (!s || s.length > 200)
    throw new Error("A name of 1–200 characters is required.");
  return s;
}
export function applyCommand(
  original: WorkspaceData,
  command: Command,
): WorkspaceData {
  const data = structuredClone(original);
  initializeAccounting(data);
  data.tables.users ??= [
    {
      id: "sample-owner",
      organization_id: data.organization.id,
      email: "owner@example.test",
      role: "owner",
      created_at: new Date().toISOString(),
    },
  ];
  delete data.inviteToken;
  const v = command.values,
    tables = data.tables;
  const role = data.role;
  if (!["owner", "admin", "fundraiser", "accountant"].includes(role))
    throw new Error("Your role cannot change these records.");
  const add = (table: string, values: Record<string, unknown>) => {
    const r: Row = {
      ...values,
      id: crypto.randomUUID(),
      organization_id: data.organization.id,
      created_at: new Date().toISOString(),
    };
    tables[table].push(r);
    return r;
  };
  const find = (table: string, id: unknown) => {
    const r = tables[table].find((r) => r.id === id);
    if (!r) throw new Error("Linked record not found.");
    return r;
  };
  const audit = (donor: unknown, type: string, details: string) =>
    add("activities", {
      donor_id: donor,
      type,
      details,
      responsible_user: "Sample owner",
    });
  const allocate = (payment: Row, items: unknown) => {
    if (payment.status !== "processed" || !Array.isArray(items))
      throw new Error("Only processed payments can be allocated.");
    for (const item of items as { pledge_id: string; amount_minor: number }[]) {
      const p = find("pledges", item.pledge_id),
        amount = Number(item.amount_minor);
      if (
        p.donor_id !== payment.donor_id ||
        !Number.isSafeInteger(amount) ||
        amount <= 0
      )
        throw new Error(
          "Allocation must use a positive amount and the same donor.",
        );
      if (amount > credit(data, payment))
        throw new Error("Allocation exceeds available payment credit.");
      if (amount > balance(data, p) - scheduled(data, p.id))
        throw new Error("Allocation exceeds the unscheduled pledge balance.");
      const existing = tables.payment_allocations.find(
        (a) => a.payment_id === payment.id && a.pledge_id === p.id,
      );
      let allocation = existing;
      if (existing)
        existing.amount_minor = Number(existing.amount_minor) + amount;
      else
        allocation = add("payment_allocations", {
          payment_id: payment.id,
          pledge_id: p.id,
          amount_minor: amount,
        });
      const fund = tables.campaigns.find(
        (c) => c.id === p.campaign_id,
      )?.fund_id;
      const target = tables.pledge_recognitions.some(
        (r) => r.pledge_id === p.id,
      )
        ? "1100"
        : "4000";
      postLedger(
        data,
        `allocation:${allocation!.id}:${allocation!.amount_minor}`,
        [
          String(payment.paid_on),
          String(
            tables.pledge_recognitions.find((r) => r.pledge_id === p.id)
              ?.recognized_on ?? payment.paid_on,
          ),
        ]
          .sort()
          .at(-1)!,
        "Donation allocated to pledge",
        "allocation",
        [
          { account_id: accountId(data, "2100"), debit_minor: amount },
          {
            account_id: accountId(data, target),
            fund_id: fund,
            credit_minor: amount,
          },
        ],
      );
    }
  };
  const payment = (values: Record<string, unknown>) => {
    const existing = tables.payments.find(
      (p) => p.idempotency_key === values.idempotency_key,
    );
    if (existing) {
      if (existing.request_payload !== JSON.stringify(values))
        throw new Error("Request key has already been used.");
      return existing;
    }
    find("donors", values.donor_id);
    const amount = Number(values.amount_minor);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999)
      throw new Error("Invalid payment amount.");
    dateValue(values.paid_on);
    if (
      !["processed", "pending", "failed"].includes(String(values.status)) ||
      ![
        "cash",
        "check",
        "bank_transfer",
        "external_card",
        "charity_card",
        "zelle",
        "other",
      ].includes(String(values.method))
    )
      throw new Error("Invalid payment status or method.");
    const p = add("payments", {
      ...values,
      amount_minor: amount,
      deposit_status: "undeposited",
      request_payload: JSON.stringify(values),
    });
    if (p.status === "processed")
      postLedger(
        data,
        `payment:${p.id}`,
        String(p.paid_on),
        "Manual payment received",
        "payment",
        [
          { account_id: accountId(data, "1050"), debit_minor: amount },
          { account_id: accountId(data, "2100"), credit_minor: amount },
        ],
      );
    if (values.installment) {
      const inst = find("installments", values.installment),
        plan = find("schedules", inst.schedule_id);
      if (
        inst.payment_id ||
        plan.status !== "active" ||
        plan.donor_id !== p.donor_id ||
        inst.amount_minor !== amount ||
        p.status !== "processed" ||
        (Array.isArray(values.allocations) && values.allocations.length)
      )
        throw new Error("Invalid installment payment.");
      inst.payment_id = p.id;
      allocate(p, [{ pledge_id: plan.pledge_id, amount_minor: amount }]);
      if (
        !tables.installments.some(
          (i) => i.schedule_id === plan.id && !i.payment_id,
        )
      )
        plan.status = "completed";
    } else if (p.status === "processed") allocate(p, values.allocations ?? []);
    else if (Array.isArray(values.allocations) && values.allocations.length)
      throw new Error("Pending or failed payments cannot fulfill pledges.");
    if (p.status === "failed")
      for (const rule of tables.automation_rules.filter(
        (r) =>
          r.active && Number(p.amount_minor) >= Number(r.min_amount_minor ?? 0),
      )) {
        const due = new Date(`${today()}T12:00:00Z`);
        due.setUTCDate(due.getUTCDate() + 1);
        add("tasks", {
          donor_id: p.donor_id,
          subject: rule.subject,
          description: `Follow up on failed payment ${p.id}`,
          assignee: "",
          priority: "high",
          due_date: due.toISOString().slice(0, 10),
          status: "open",
        });
        add("job_logs", {
          name: rule.name,
          status: "completed",
          details: `Created donor follow-up task for payment ${p.id}`,
        });
      }
    audit(
      p.donor_id,
      "payment",
      `Manual ${p.method} payment recorded: ${p.status}`,
    );
    return p;
  };
  switch (command.type) {
    case "payment_status": {
      const payment = find("payments", v.payment),
        date = dateValue(v.dated);
      if (
        payment.status !== "pending" ||
        !["processed", "failed"].includes(String(v.new_status)) ||
        date < String(payment.paid_on)
      )
        throw new Error("Invalid pending-payment resolution.");
      payment.status = v.new_status;
      payment.paid_on = date;
      if (payment.status === "processed")
        postLedger(
          data,
          `payment:${payment.id}`,
          date,
          "Manual payment received",
          "payment",
          [
            {
              account_id: accountId(data, "1050"),
              debit_minor: payment.amount_minor,
            },
            {
              account_id: accountId(data, "2100"),
              credit_minor: payment.amount_minor,
            },
          ],
        );
      if (payment.status === "failed")
        for (const rule of tables.automation_rules.filter(
          (r) =>
            r.active &&
            Number(payment.amount_minor) >= Number(r.min_amount_minor ?? 0),
        )) {
          const due = new Date(`${today()}T12:00:00Z`);
          due.setUTCDate(due.getUTCDate() + 1);
          add("tasks", {
            donor_id: payment.donor_id,
            subject: rule.subject,
            description: `Follow up on failed payment ${payment.id}`,
            assignee: "",
            priority: "high",
            due_date: due.toISOString().slice(0, 10),
            status: "open",
          });
          add("job_logs", {
            name: rule.name,
            status: "completed",
            details: `Created donor follow-up task for payment ${payment.id}`,
          });
        }
      audit(
        payment.donor_id,
        "payment",
        `Pending payment resolved as ${v.new_status}`,
      );
      break;
    }
    case "invite": {
      if (
        !["owner", "admin"].includes(role) ||
        !["admin", "fundraiser", "accountant", "viewer"].includes(
          String(v.invite_role),
        ) ||
        (role !== "owner" && v.invite_role === "admin")
      )
        throw new Error("Permission denied.");
      const email = String(v.invite_email ?? "")
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Valid email required.");
      add("invitations", {
        email,
        role: v.invite_role,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        accepted_at: null,
      });
      data.inviteToken = "SAMPLE-ONLY-" + crypto.randomUUID();
      break;
    }
    case "member_role": {
      if (
        role !== "owner" ||
        !["owner", "admin", "fundraiser", "accountant", "viewer"].includes(
          String(v.new_role),
        )
      )
        throw new Error("Only owners can change roles.");
      const member = find("users", v.member);
      if (
        member.role === "owner" &&
        v.new_role !== "owner" &&
        tables.users.filter((u) => u.role === "owner").length <= 1
      )
        throw new Error("An organization must retain an owner.");
      member.role = v.new_role;
      break;
    }
    case "automation_status": {
      const rule = find("automation_rules", v.rule);
      if (!["owner", "admin"].includes(role))
        throw new Error("Administrator access required.");
      rule.active = Boolean(v.enabled);
      break;
    }
    case "bootstrap":
      break;
    case "account":
    case "journal":
    case "recognize":
    case "deposit":
    case "bill":
    case "pay_bill":
    case "bank_import":
    case "bank_match":
    case "bank_create":
    case "reconcile": {
      applyAccounting(data, command);
      break;
    }
    case "donor_update": {
      if (role === "accountant")
        throw new Error("Your role cannot edit contacts.");
      const d = find("donors", v.donor),
        a = v.attributes as Record<string, unknown>;
      const allowed = [
        "name",
        "title",
        "hebrew_name",
        "first_name",
        "last_name",
        "english_name",
        "alternate_names",
        "phone_contacts",
        "email_contacts",
        "active",
        "email",
        "emails",
        "phones",
        "addresses",
        "tags",
        "notes",
        "occasions",
        "custom_fields",
        "receipt_language",
        "fundraiser_id",
      ];
      if (a.name !== undefined) required(a.name);
      for (const key of allowed) if (a[key] !== undefined) d[key] = a[key];
      validateCustomFields(data, d);
      audit(d.id, "updated", "Donor contact information updated");
      break;
    }
    case "organization_update": {
      if (!["owner", "admin"].includes(role))
        throw new Error(
          "Only organization administrators can change settings.",
        );
      const a = v.attributes as Record<string, unknown>;
      required(a.name);
      for (const key of ["name", "hebrew_name", "tax_id", "timezone"])
        if (a[key] !== undefined) data.organization[key] = a[key];
      break;
    }
    case "task_status": {
      if (
        role === "accountant" ||
        !["open", "done"].includes(String(v.new_status))
      )
        throw new Error("Invalid task update.");
      const task = find("tasks", v.task);
      task.status = v.new_status;
      audit(
        task.donor_id,
        "task",
        `Task marked ${v.new_status}: ${task.subject}`,
      );
      break;
    }
    case "insert": {
      const table = command.table!;
      if (
        ![
          "donors",
          "campaigns",
          "pledges",
          "funds",
          "fundraisers",
          "donor_accounts",
          "donor_lists",
          "list_members",
          "events",
          "sponsorships",
          "tasks",
          "attachments",
          "vendors",
          "custom_field_definitions",
          "automation_rules",
          "devices",
          "gateway_accounts",
          "document_templates",
          "notification_preferences",
        ].includes(table) ||
        (role === "accountant" && table !== "vendors")
      )
        throw new Error("This record cannot be added by your role.");
      if (
        [
          "custom_field_definitions",
          "automation_rules",
          "devices",
          "gateway_accounts",
          "document_templates",
          "notification_preferences",
        ].includes(table) &&
        !["owner", "admin"].includes(role)
      )
        throw new Error("Administrator access required.");
      const values = { ...v };
      if (
        table === "custom_field_definitions" &&
        (!/^[a-z][a-z0-9_]{0,49}$/.test(String(v.field_key)) ||
          tables.custom_field_definitions.some(
            (f) => f.field_key === v.field_key,
          ))
      )
        throw new Error("Use a unique lowercase custom-field key.");
      if (!["pledges", "list_members", "tasks", "attachments"].includes(table))
        values.name = required(v.name);
      if (v.donor_id) find("donors", v.donor_id);
      for (const [key, target] of [
        ["campaign_id", "campaigns"],
        ["fund_id", "funds"],
        ["fundraiser_id", "fundraisers"],
        ["event_id", "events"],
        ["sponsorship_id", "sponsorships"],
        ["list_id", "donor_lists"],
      ])
        if (v[key]) find(target, v[key]);
      if (table === "pledges") {
        if (v.sponsorship_id) {
          const sponsor = find("sponsorships", v.sponsorship_id);
          if (
            tables.pledges.filter((p) => p.sponsorship_id === sponsor.id)
              .length >= Number(sponsor.availability_limit)
          )
            throw new Error("This sponsorship has no remaining availability.");
        }
        find("donors", v.donor_id);
        find("campaigns", v.campaign_id);
        if (
          !Number.isSafeInteger(v.amount_minor) ||
          Number(v.amount_minor) <= 0
        )
          throw new Error("Invalid pledge amount.");
        dateValue(v.due_date);
        dateValue(v.pledged_on);
      }
      if (table === "tasks") {
        required(v.subject);
        dateValue(v.due_date);
      }
      if (table === "events") dateValue(v.event_date);
      if (
        table === "donors" &&
        v.receipt_language &&
        !["en", "he"].includes(String(v.receipt_language))
      )
        throw new Error("Invalid receipt language.");
      if (table === "donors") validateCustomFields(data, values);
      const r = add(table, values);
      audit(
        table === "donors" ? r.id : v.donor_id,
        "created",
        `${table.replaceAll("_", " ")} record created`,
      );
      break;
    }
    case "donation_payment": {
      find("campaigns", v.campaign_id);
      for (const [key, table] of [
        ["fundraiser_id", "fundraisers"],
        ["sponsorship_id", "sponsorships"],
        ["event_id", "events"],
      ])
        if (v[key]) find(table, v[key]);
      const existing = tables.payments.find(
        (p) => p.idempotency_key === v.idempotency_key,
      );
      if (existing) {
        payment(v);
        break;
      }
      if (
        !v.installment &&
        Array.isArray(v.allocations) &&
        !v.allocations.length &&
        !v.credit_confirmed &&
        tables.pledges.some(
          (p) => p.donor_id === v.donor_id && balance(data, p) > 0,
        )
      )
        throw new Error(
          "Confirm leaving this donation unapplied to open pledges",
        );
      payment(v);
      break;
    }
    case "donation_edit": {
      if (!["pledges", "payments"].includes(String(v.kind)))
        throw new Error("Invalid record kind");
      const row = find(String(v.kind), v.record_id),
        a = v.attributes as Record<string, unknown>;
      if (v.kind === "pledges") {
        if (row.voided_at) throw new Error("Voided pledges cannot be edited");
        const changed =
          Number(a.amount_minor) !== Number(row.amount_minor) ||
          a.campaign_id !== row.campaign_id ||
          a.pledged_on !== row.pledged_on;
        if (
          changed &&
          (tables.payment_allocations.some((x) => x.pledge_id === row.id) ||
            tables.schedules.some(
              (x) =>
                x.pledge_id === row.id &&
                ["active", "paused"].includes(String(x.status)),
            ) ||
            tables.pledge_recognitions.some((x) => x.pledge_id === row.id))
        )
          throw new Error(
            "Amount, campaign and pledge date are locked after financial activity",
          );
        find("campaigns", a.campaign_id);
        if (
          !Number.isSafeInteger(a.amount_minor) ||
          Number(a.amount_minor) <= 0
        )
          throw new Error("Invalid pledge amount");
        dateValue(a.pledged_on);
        dateValue(a.due_date);
        for (const key of [
          "amount_minor",
          "campaign_id",
          "pledged_on",
          "due_date",
          "receipt_requested",
        ])
          row[key] = a[key];
      }
      for (const [key, table] of [
        ["fundraiser_id", "fundraisers"],
        ["sponsorship_id", "sponsorships"],
        ["event_id", "events"],
      ]) {
        if (a[key]) find(table, a[key]);
        row[key] = a[key] || null;
      }
      row.description = String(a.description ?? "");
      if (v.kind === "payments") row.collector = String(a.collector ?? "");
      row.updated_at = new Date().toISOString();
      audit(row.donor_id, "edited", `${v.kind} record updated: ${row.id}`);
      break;
    }
    case "pledge_void": {
      const p = find("pledges", v.pledge);
      if (
        tables.payment_allocations.some((x) => x.pledge_id === p.id) ||
        tables.schedules.some(
          (x) =>
            x.pledge_id === p.id &&
            ["active", "paused"].includes(String(x.status)),
        ) ||
        tables.pledge_recognitions.some((x) => x.pledge_id === p.id)
      )
        throw new Error("Cannot void a pledge with financial activity");
      p.voided_at = new Date().toISOString();
      audit(p.donor_id, "voided", `Pledge voided: ${p.id}`);
      break;
    }
    case "payment":
      payment(v);
      break;
    case "batch":
      if (
        !Array.isArray(v.entries) ||
        v.entries.length < 1 ||
        v.entries.length > 100
      )
        throw new Error("Batch requires 1–100 payments.");
      for (const entry of v.entries) payment(entry);
      break;
    case "allocate": {
      const p = find("payments", v.payment);
      allocate(p, v.allocations);
      audit(p.donor_id, "allocation", "Available donor credit allocated");
      break;
    }
    case "schedule": {
      const p = find("pledges", v.pledge),
        total = Number(v.total),
        count = Number(v.count),
        frequency = String(v.schedule_frequency);
      if (
        !Number.isSafeInteger(total) ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > 120 ||
        total < count ||
        !["weekly", "monthly", "quarterly", "yearly"].includes(frequency) ||
        !["installment", "recurring"].includes(String(v.schedule_kind))
      )
        throw new Error("Invalid schedule values.");
      if (total > balance(data, p) - scheduled(data, p.id))
        throw new Error("Schedule exceeds available pledge balance.");
      const start = dateValue(v.first_date),
        plan = add("schedules", {
          donor_id: p.donor_id,
          pledge_id: p.id,
          total_minor: total,
          payment_count: count,
          start_date: start,
          kind: v.schedule_kind,
          frequency,
          status: "active",
          error: "",
        });
      for (let i = 0; i < count; i++) {
        const d = new Date(`${start}T12:00:00Z`);
        if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7 * i);
        else {
          const day = d.getUTCDate();
          d.setUTCDate(1);
          d.setUTCMonth(
            d.getUTCMonth() +
              i * ({ monthly: 1, quarterly: 3, yearly: 12 }[frequency] ?? 1),
          );
          const last = new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
          ).getUTCDate();
          d.setUTCDate(Math.min(day, last));
        }
        add("installments", {
          schedule_id: plan.id,
          due_date: d.toISOString().slice(0, 10),
          amount_minor: Math.floor(total / count) + (i < total % count ? 1 : 0),
          payment_id: null,
        });
      }
      audit(
        p.donor_id,
        "schedule",
        "Payment plan created; automatic processing is not connected",
      );
      break;
    }
    case "schedule_status": {
      const s = find("schedules", v.plan);
      if (
        ["completed", "cancelled"].includes(String(s.status)) ||
        !["active", "paused", "cancelled"].includes(String(v.new_status))
      )
        throw new Error("Invalid schedule status transition.");
      s.status = v.new_status;
      break;
    }
    case "receipt": {
      const p = find("payments", v.payment);
      if (p.status !== "processed")
        throw new Error("Only processed payments can be receipted.");
      if (!tables.receipts.some((r) => r.payment_id === p.id)) {
        const d = find("donors", p.donor_id);
        add("receipts", {
          payment_id: p.id,
          number: tables.receipts.length + 1,
          language: d.receipt_language ?? "en",
          snapshot: {
            description:
              p.description ||
              tables.payment_allocations
                .filter((a) => a.payment_id === p.id)
                .map(
                  (a) =>
                    tables.pledges.find((pl) => pl.id === a.pledge_id)
                      ?.description,
                )
                .filter(Boolean)
                .join("; "),
            template:
              tables.document_templates
                .filter((t) => t.language === (d.receipt_language ?? "en"))
                .at(-1)?.body ?? "",
            organization: data.organization.name,
            tax_id: data.organization.tax_id ?? "",
            donor: d.name,
            hebrew_name: d.hebrew_name ?? "",
            amount_minor: p.amount_minor,
            paid_on: p.paid_on,
            method: p.method,
            reference: p.reference ?? "",
          },
        });
      }
      break;
    }
    default:
      throw new Error("Unsupported operation.");
  }
  return data;
}

export const defaultAccounts = [
  ["1000", "Chase operating account", "asset", "bank"],
  ["1050", "Undeposited funds", "asset", "undeposited"],
  ["1100", "Pledges receivable", "asset", "receivable"],
  ["2000", "Accounts payable", "liability", "payable"],
  ["2100", "Unapplied donor credit", "liability", "donor_credit"],
  ["3000", "Opening net assets", "equity", "opening"],
  ["4000", "Contributions", "income", "contributions"],
  ["4100", "Other income", "income", "general"],
  ["5000", "Program expenses", "expense", "general"],
  ["5100", "Office & administration", "expense", "general"],
  ["5200", "Processing fees", "expense", "general"],
];
export const accountId = (data: WorkspaceData, code: string) =>
  data.tables.accounts.find((a) => a.code === code)!.id;
export function accountBalance(
  data: WorkspaceData,
  id: string,
  through = "9999-12-31",
) {
  const entries = data.tables.journal_entries
    .filter((e) => String(e.entry_date) <= through)
    .map((e) => e.id);
  return data.tables.journal_lines
    .filter((l) => l.account_id === id && entries.includes(String(l.entry_id)))
    .reduce((n, l) => n + Number(l.debit_minor) - Number(l.credit_minor), 0);
}
export function postLedger(
  data: WorkspaceData,
  key: string,
  date: string,
  description: string,
  source: string,
  lines: Record<string, unknown>[],
) {
  dateValue(date);
  const previous = data.tables.journal_entries.find((e) => e.event_key === key);
  if (previous) {
    if (
      previous.payload !== JSON.stringify(lines) ||
      previous.description !== description ||
      previous.entry_date !== date
    )
      throw new Error("Journal request key used for different data.");
    return previous.id;
  }
  if (lines.length < 2 || !description.trim())
    throw new Error("Journal requires a description and at least two lines.");
  let debit = 0,
    credit = 0;
  for (const l of lines) {
    const d = Number(l.debit_minor ?? 0),
      c = Number(l.credit_minor ?? 0);
    if (
      !Number.isSafeInteger(d) ||
      !Number.isSafeInteger(c) ||
      d < 0 ||
      c < 0 ||
      d > 0 === c > 0 ||
      !data.tables.accounts.some((a) => a.id === l.account_id)
    )
      throw new Error("Invalid journal line.");
    const cutoff = data.tables.reconciliations
      .filter((r) => r.bank_account_id === l.account_id)
      .map((r) => String(r.statement_date))
      .sort()
      .at(-1);
    if (cutoff && date <= cutoff)
      throw new Error("Cannot backdate a reconciled bank period.");
    debit += d;
    credit += c;
  }
  if (debit !== credit || debit <= 0)
    throw new Error("Journal debits must equal credits.");
  const entry = crypto.randomUUID(),
    created_at = new Date().toISOString(),
    organization_id = data.organization.id;
  data.tables.journal_entries.push({
    id: entry,
    organization_id,
    event_key: key,
    entry_date: date,
    description,
    source,
    payload: JSON.stringify(lines),
    created_at,
  });
  for (const l of lines)
    data.tables.journal_lines.push({
      ...l,
      id: crypto.randomUUID(),
      organization_id,
      entry_id: entry,
      debit_minor: l.debit_minor ?? 0,
      credit_minor: l.credit_minor ?? 0,
      created_at,
    });
  return entry;
}
export function initializeAccounting(data: WorkspaceData) {
  for (const name of tableNames) data.tables[name] ??= [];
  if (data.tables.accounts.length) return;
  for (const [code, name, kind, purpose] of defaultAccounts)
    data.tables.accounts.push({
      id: crypto.randomUUID(),
      organization_id: data.organization.id,
      code,
      name,
      kind,
      purpose,
      created_at: new Date().toISOString(),
    });
  for (const p of data.tables.payments.filter((p) => p.status === "processed"))
    postLedger(
      data,
      `payment:${p.id}`,
      String(p.paid_on),
      "Manual payment received",
      "payment",
      [
        { account_id: accountId(data, "1050"), debit_minor: p.amount_minor },
        { account_id: accountId(data, "2100"), credit_minor: p.amount_minor },
      ],
    );
  for (const a of data.tables.payment_allocations) {
    const p = data.tables.payments.find((p) => p.id === a.payment_id)!,
      pledge = data.tables.pledges.find((p) => p.id === a.pledge_id)!,
      fund = data.tables.campaigns.find(
        (c) => c.id === pledge.campaign_id,
      )?.fund_id;
    postLedger(
      data,
      `allocation:${a.id}:${a.amount_minor}`,
      String(p.paid_on),
      "Donation allocated to pledge",
      "allocation",
      [
        { account_id: accountId(data, "2100"), debit_minor: a.amount_minor },
        {
          account_id: accountId(data, "4000"),
          fund_id: fund,
          credit_minor: a.amount_minor,
        },
      ],
    );
  }
}
function applyAccounting(data: WorkspaceData, command: Command) {
  if (!["owner", "admin", "accountant"].includes(data.role))
    throw new Error("Accounting permissions required.");
  const v = command.values,
    t = data.tables,
    find = (table: string, id: unknown) => {
      const r = t[table].find((r) => r.id === id);
      if (!r) throw new Error("Record not found.");
      return r;
    };
  const add = (table: string, values: Record<string, unknown>) => {
    const r: Row = {
      ...values,
      id: crypto.randomUUID(),
      organization_id: data.organization.id,
      created_at: new Date().toISOString(),
    };
    t[table].push(r);
    return r;
  };
  const bank = (id: unknown) => {
    const a = find("accounts", id);
    if (a.purpose !== "bank") throw new Error("Select a bank account.");
    return a;
  };
  const amount = (n: unknown) => {
    if (!Number.isSafeInteger(n) || Number(n) <= 0)
      throw new Error("A positive amount is required.");
    return Number(n);
  };
  if (command.type === "account") {
    required(v.account_code);
    required(v.account_name);
    if (
      !["asset", "liability", "income", "expense", "equity"].includes(
        String(v.account_kind),
      ) ||
      !["general", "bank"].includes(String(v.account_purpose)) ||
      (v.account_purpose === "bank" && v.account_kind !== "asset") ||
      t.accounts.some((a) => a.code === v.account_code)
    )
      throw new Error("Invalid or duplicate account.");
    add("accounts", {
      code: v.account_code,
      name: v.account_name,
      kind: v.account_kind,
      purpose: v.account_purpose,
    });
  } else if (command.type === "journal") {
    if (
      (v.lines as Record<string, unknown>[]).some((l) =>
        [
          "receivable",
          "payable",
          "donor_credit",
          "undeposited",
          "contributions",
        ].includes(String(find("accounts", l.account_id).purpose)),
      )
    )
      throw new Error(
        "Use linked donor, payment, deposit or bill workflows for control accounts.",
      );
    postLedger(
      data,
      `manual:${v.request_key}`,
      dateValue(v.dated),
      String(v.memo),
      "manual",
      v.lines as Record<string, unknown>[],
    );
  } else if (command.type === "recognize") {
    const p = find("pledges", v.pledge),
      open = balance(data, p);
    if (open <= 0 || t.pledge_recognitions.some((r) => r.pledge_id === p.id))
      throw new Error("No unrecognized pledge balance remains.");
    const fund = t.campaigns.find((c) => c.id === p.campaign_id)?.fund_id,
      date = dateValue(v.dated),
      entry = postLedger(
        data,
        `recognition:${p.id}`,
        date,
        "Unconditional pledge recognized",
        "recognition",
        [
          {
            account_id: accountId(data, "1100"),
            fund_id: fund,
            debit_minor: open,
          },
          {
            account_id: accountId(data, "4000"),
            fund_id: fund,
            credit_minor: open,
          },
        ],
      );
    add("pledge_recognitions", {
      pledge_id: p.id,
      amount_minor: open,
      recognized_on: date,
      entry_id: entry,
    });
  } else if (command.type === "deposit") {
    bank(v.bank);
    const ids = v.payments as string[];
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new Error("Select distinct payments.");
    const payments = ids.map((id) => find("payments", id)),
      date = dateValue(v.dated);
    if (
      payments.some(
        (p) =>
          p.status !== "processed" ||
          p.deposit_status !== "undeposited" ||
          String(p.paid_on) > date,
      )
    )
      throw new Error("Payment cannot be deposited on this date.");
    const total = sum(payments, "amount_minor");
    postLedger(
      data,
      `deposit:${v.request_key}`,
      date,
      "Deposit of received payments",
      "deposit",
      [
        { account_id: v.bank, debit_minor: total },
        { account_id: accountId(data, "1050"), credit_minor: total },
      ],
    );
    payments.forEach((p) => (p.deposit_status = "deposited"));
  } else if (command.type === "bill") {
    find("vendors", v.vendor);
    const a = find("accounts", v.expense_account);
    if (
      a.kind !== "expense" ||
      t.bills.some(
        (b) => b.vendor_id === v.vendor && b.invoice_reference === v.invoice,
      )
    )
      throw new Error("Select an expense account and a unique invoice.");
    const n = amount(v.amount),
      date = dateValue(v.dated);
    dateValue(v.due);
    required(v.invoice);
    const b = add("bills", {
      vendor_id: v.vendor,
      invoice_reference: v.invoice,
      bill_date: date,
      due_date: v.due,
      amount_minor: n,
      expense_account_id: v.expense_account,
      fund_id: v.fund,
      description: v.memo ?? "",
    });
    postLedger(data, `bill:${b.id}`, date, `Bill ${v.invoice}`, "bill", [
      { account_id: a.id, fund_id: v.fund, debit_minor: n },
      { account_id: accountId(data, "2000"), fund_id: v.fund, credit_minor: n },
    ]);
  } else if (command.type === "pay_bill") {
    const b = find("bills", v.bill);
    bank(v.bank);
    const n = amount(v.amount),
      settled = sum(
        t.bill_payments.filter((p) => p.bill_id === b.id),
        "amount_minor",
      ),
      date = dateValue(v.dated);
    if (
      n > Number(b.amount_minor) - settled ||
      date < String(b.bill_date) ||
      !["check", "bank_transfer"].includes(String(v.payment_method)) ||
      (v.payment_method === "check" &&
        (!v.check_reference ||
          t.bill_payments.some(
            (p) =>
              p.bank_account_id === v.bank &&
              p.check_number === v.check_reference,
          )))
    )
      throw new Error("Invalid or duplicate bill payment.");
    if (t.bill_payments.some((p) => p.request_key === v.request_key))
      throw new Error("Bill payment request already recorded.");
    const p = add("bill_payments", {
      bill_id: b.id,
      bank_account_id: v.bank,
      amount_minor: n,
      paid_on: date,
      method: v.payment_method,
      check_number: v.check_reference,
      memo: v.memo ?? "",
      request_key: v.request_key,
    });
    postLedger(
      data,
      `bill-payment:${p.id}`,
      date,
      `Bill payment ${b.invoice_reference}`,
      "bill_payment",
      [
        {
          account_id: accountId(data, "2000"),
          fund_id: b.fund_id,
          debit_minor: n,
        },
        { account_id: v.bank, fund_id: b.fund_id, credit_minor: n },
      ],
    );
  } else if (command.type === "bank_import") {
    bank(v.bank);
    const rows = v.rows as Record<string, unknown>[];
    if (!rows.length || rows.length > 500)
      throw new Error("Import requires 1–500 rows.");
    let added = 0,
      failed = 0,
      duplicates = 0;
    const errors: Record<string, unknown>[] = [];
    rows.forEach((r, i) => {
      try {
        required(r.external_id);
        required(r.description);
        dateValue(r.transaction_date);
        if (
          !Number.isSafeInteger(r.amount_minor) ||
          Number(r.amount_minor) === 0
        )
          throw new Error("Nonzero integer cents required.");
        if (
          t.bank_transactions.some(
            (b) =>
              b.bank_account_id === v.bank && b.external_id === r.external_id,
          )
        ) {
          duplicates++;
          return;
        }
        add("bank_transactions", {
          ...r,
          bank_account_id: v.bank,
          status: "unmatched",
          entry_id: null,
        });
        added++;
      } catch (e) {
        failed++;
        errors.push({
          row: i + 1,
          error: e instanceof Error ? e.message : "Invalid row",
        });
      }
    });
    if (duplicates) errors.push({ duplicates_skipped: duplicates });
    add("import_runs", {
      name: v.import_name ?? "Bank import",
      added,
      updated: 0,
      failed,
      errors,
    });
  } else if (command.type === "bank_match" || command.type === "bank_create") {
    const b = find("bank_transactions", v.bank_transaction);
    if (b.status !== "unmatched") throw new Error("Bank row already matched.");
    let entry = v.entry as string;
    if (command.type === "bank_create") {
      const a = find("accounts", v.category),
        n = Number(b.amount_minor);
      if (
        [
          "receivable",
          "payable",
          "donor_credit",
          "undeposited",
          "contributions",
        ].includes(String(a.purpose))
      )
        throw new Error(
          "Use linked donor or bill workflows for control accounts.",
        );
      if (
        (n > 0 &&
          !["income", "liability", "equity"].includes(String(a.kind))) ||
        (n < 0 && !["expense", "liability", "equity"].includes(String(a.kind)))
      )
        throw new Error("Choose a suitable category.");
      const lines =
        n > 0
          ? [
              {
                account_id: b.bank_account_id,
                fund_id: v.fund,
                debit_minor: n,
              },
              { account_id: a.id, fund_id: v.fund, credit_minor: n },
            ]
          : [
              { account_id: a.id, fund_id: v.fund, debit_minor: -n },
              {
                account_id: b.bank_account_id,
                fund_id: v.fund,
                credit_minor: -n,
              },
            ];
      entry = postLedger(
        data,
        `bank:${b.id}`,
        String(b.transaction_date),
        String(b.description),
        "bank",
        lines,
      );
    }
    find("journal_entries", entry);
    const delta = t.journal_lines
      .filter((l) => l.entry_id === entry && l.account_id === b.bank_account_id)
      .reduce((n, l) => n + Number(l.debit_minor) - Number(l.credit_minor), 0);
    if (
      delta !== b.amount_minor ||
      t.bank_transactions.some(
        (r) => r.bank_account_id === b.bank_account_id && r.entry_id === entry,
      )
    )
      throw new Error("Ledger amount differs or entry already matched.");
    b.entry_id = entry;
    b.status = "matched";
  } else if (command.type === "reconcile") {
    bank(v.bank);
    const date = dateValue(v.statement_date),
      entries = v.entries as string[],
      previous = t.reconciliations
        .filter((r) => r.bank_account_id === v.bank)
        .sort((a, b) =>
          String(b.statement_date).localeCompare(String(a.statement_date)),
        )[0];
    if (previous && date <= String(previous.statement_date))
      throw new Error("Statement must follow previous reconciliation.");
    if (
      new Set(entries).size !== entries.length ||
      !Number.isSafeInteger(v.ending_balance)
    )
      throw new Error("Invalid reconciliation.");
    let delta = 0;
    for (const id of entries) {
      const e = find("journal_entries", id),
        lines = t.journal_lines.filter(
          (l) => l.entry_id === id && l.account_id === v.bank,
        );
      if (
        String(e.entry_date) > date ||
        !lines.length ||
        t.reconciliation_items.some(
          (i) => i.bank_account_id === v.bank && i.entry_id === id,
        )
      )
        throw new Error("Invalid or already reconciled entry.");
      delta += lines.reduce(
        (n, l) => n + Number(l.debit_minor) - Number(l.credit_minor),
        0,
      );
    }
    const start = Number(previous?.ending_balance_minor ?? 0);
    if (start + delta !== v.ending_balance)
      throw new Error("Reconciliation difference must be zero.");
    const r = add("reconciliations", {
      bank_account_id: v.bank,
      statement_date: date,
      ending_balance_minor: v.ending_balance,
      starting_balance_minor: start,
    });
    entries.forEach((entry_id) =>
      add("reconciliation_items", {
        reconciliation_id: r.id,
        bank_account_id: v.bank,
        entry_id,
      }),
    );
  }
}

function validateCustomFields(
  data: WorkspaceData,
  donor: Record<string, unknown>,
) {
  const values = (donor.custom_fields as Record<string, unknown>) ?? {};
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error("Custom fields must be an object.");
  for (const field of data.tables.custom_field_definitions) {
    const value = values[String(field.field_key)];
    if (value === undefined || value === null || value === "") {
      if (field.required)
        throw new Error(`Required custom field: ${field.name}`);
      continue;
    }
    const type =
      field.field_type === "date"
        ? "string"
        : field.field_type === "text"
          ? "string"
          : String(field.field_type);
    if (typeof value !== type)
      throw new Error(`Incorrect type for custom field: ${field.name}`);
    if (field.field_type === "date") dateValue(value);
  }
}

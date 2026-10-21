import {
  balance,
  paid,
  scheduled,
  donorTotals,
  currency,
  credit,
  sum,
  today,
  accountBalance,
  type WorkspaceData,
  type Row,
} from "./domain";
import type { Column, TableRow } from "@/components/data-table";

export const pageTitles: Record<string, string> = {
  dashboard: "Dashboard",
  calendar: "Calendar",
  donors: "Donors",
  donor_accounts: "Donor accounts",
  donor_lists: "Lists",
  pledges: "Pledges",
  payments: "Payments",
  schedules: "Payment schedules",
  receipts: "Receipts",
  campaigns: "Campaigns",
  fundraisers: "Fundraisers",
  sponsorships: "Sponsorships",
  events: "Events",
  tasks: "Tasks",
  activities: "Activity history",
  reports: "Fundraising reports",
  funds: "Funds",
  settings: "Organization",
  users: "Users & permissions",
  vendors: "Vendors",
  bills: "Bills",
  checks: "Print checks",
  transactions: "Transactions",
  accounts: "Chart of accounts",
  bank: "Bank feed",
  reconciliation: "Reconciliation",
  financial_reports: "Financial reports",
  devices: "Donation devices",
  links: "Donation links",
  gateways: "Payment gateways",
  modules: "Modules & custom fields",
  automations: "Automations",
  templates: "Document templates",
  notifications: "Notifications",
  integrations: "API & webhooks",
  jobs: "Background jobs",
  imports: "Import & export history",
  webhooks: "Failed webhooks",
};
export function tableView(
  page: string,
  data: WorkspaceData,
): { columns: Column[]; rows: TableRow[] } {
  const t = data.tables;
  const donorColumns = (p: Row) => {
    const d = t.donors.find((d) => d.id === p.donor_id);
    const phones = Array.isArray(d?.phone_contacts)
      ? (d.phone_contacts as { label?: string; value?: string }[])
      : [];
    return {
      id: p.id,
      description: String(p.description ?? ""),
      sponsorship: name("sponsorships", p.sponsorship_id),
      sponsorship_date: String(p.sponsorship_date ?? "—"),
      event: name("events", p.event_id),
      created: String(p.created_at ?? "—"),
      updated: String(p.updated_at ?? p.created_at ?? "—"),
      donor_email: String(d?.email ?? "—"),
      donor_phone: String(
        phones.find((x) => x.label?.toLowerCase() === "home")?.value ??
          (Array.isArray(d?.phones) ? d.phones[0] : "—") ??
          "—",
      ),
      donor_cell: String(
        phones.find((x) => x.label?.toLowerCase() === "cell")?.value ?? "—",
      ),
      donor_notes: String(d?.notes ?? ""),
      donor_address: (Array.isArray(d?.addresses)
        ? (d.addresses as Record<string, unknown>[])
        : []
      )
        .map((a) =>
          String(
            a.address ||
              [a.number, a.line1, a.line2, a.city, a.state, a.zip, a.country]
                .filter(Boolean)
                .join(", "),
          ),
        )
        .filter(Boolean)
        .join("; "),
      donor_email_receipts:
        Array.isArray(d?.email_contacts) &&
        d.email_contacts.some((x: { consent?: boolean }) => x.consent)
          ? "Yes"
          : "No consent recorded",
      receipt_language: String(d?.receipt_language ?? "en"),
      currency: "USD",
      home_amount: currency(p.amount_minor),
      source_type: String(p.source_type ?? "App"),
      source_ref: String(p.reference ?? "—"),
      note: String(p.note ?? ""),
      tags: Array.isArray(d?.tags) ? d.tags.join(", ") : "",
      import_id: String(p.import_id ?? "—"),
      source_pledge: String(p.source_pledge_id ?? "—"),
      schedule_id: String(
        t.schedules.find((x) => x.pledge_id === p.id)?.id ?? "—",
      ),
      scheduled_date: String(
        t.installments
          .filter(
            (i) =>
              !i.payment_id &&
              t.schedules.some(
                (x) => x.id === i.schedule_id && x.pledge_id === p.id,
              ),
          )
          .sort((a, b) =>
            String(a.due_date).localeCompare(String(b.due_date)),
          )[0]?.due_date ?? "—",
      ),
    };
  };
  const extraColumns = {
    id: "ID",
    type: "Type",
    description: "Description",
    sponsorship: "Sponsorship",
    sponsorship_date: "Sponsorship Date",
    event: "Event",
    created: "Created Time",
    updated: "Updated Time",
    donor_email: "Donor Email",
    donor_phone: "Donor Phone",
    donor_cell: "Donor Cell",
    donor_notes: "Donor Notes",
    donor_address: "Donor Address Line 1",
    donor_email_receipts: "Donor Send Email Receipts",
    receipt_language: "Receipt Language",
    currency: "Currency Code",
    home_amount: "Home Currency Amount",
    source_type: "Source Type",
    source_ref: "Source Ref",
    note: "Note",
    tags: "Donor Tags",
    import_id: "Import ID",
    source_pledge: "Source Pledge ID",
    schedule_id: "Schedule ID",
    scheduled_date: "Scheduled Date",
  };
  const name = (table: string, id: unknown) =>
    String(t[table].find((r) => r.id === id)?.name ?? "—");
  let keys: Record<string, string> = {},
    rows: TableRow[] = [];
  const view = (
    source: Row[],
    get: (r: Row) => Record<string, string | number>,
  ) =>
    source.map((r) => ({
      id: r.id,
      values: get(r),
      status: String(get(r).status ?? "").trim() || undefined,
    }));
  if (
    [
      "modules",
      "users",
      "invitations",
      "devices",
      "gateways",
      "templates",
      "notifications",
      "automations",
      "jobs",
      "webhooks",
    ].includes(page)
  ) {
    const sources: Record<string, string> = {
      modules: "custom_field_definitions",
      users: "users",
      invitations: "invitations",
      devices: "devices",
      gateways: "gateway_accounts",
      templates: "document_templates",
      notifications: "notification_preferences",
      automations: "automation_rules",
      jobs: "job_logs",
      webhooks: "webhook_logs",
    };
    if (page === "modules")
      keys = {
        name: "Field label",
        key: "Key",
        type: "Type",
        required: "Required",
      };
    if (page === "users")
      keys = { email: "User email", role: "Role", created: "Joined" };
    if (page === "invitations")
      keys = {
        email: "Invited email",
        role: "Role",
        expires: "Expires",
        status: "Status",
      };
    if (page === "devices")
      keys = {
        name: "Device",
        serial: "Identifier",
        location: "Location",
        provider: "Provider",
        status: "Connection",
      };
    if (page === "gateways")
      keys = {
        name: "Account",
        provider: "Provider",
        reference: "Merchant reference",
        environment: "Environment",
        status: "Connection",
      };
    if (page === "templates")
      keys = {
        name: "Template",
        language: "Language",
        body: "Acknowledgment text",
        created: "Version created",
      };
    if (page === "notifications")
      keys = {
        name: "Preference version",
        summary: "Daily summary",
        failed: "Failed-payment notices",
        hour: "Schedule hour",
        retries: "Retry limit",
        status: "Delivery",
      };
    if (page === "automations")
      keys = {
        name: "Rule",
        event: "Trigger",
        minimum: "Minimum amount",
        action: "Action",
        status: "Status",
      };
    if (page === "jobs")
      keys = {
        name: "Operation",
        details: "Details",
        created: "Executed",
        status: "Status",
      };
    if (page === "webhooks")
      keys = {
        provider: "Provider",
        reference: "Event reference",
        error: "Error",
        created: "Received",
        status: "Status",
      };
    rows = view(t[sources[page]] ?? [], (r) => ({
      name: String(r.name ?? ""),
      key: String(r.field_key ?? ""),
      type: String(r.field_type ?? ""),
      required: r.required ? "Yes" : "No",
      email: String(r.email ?? ""),
      role: String(r.role ?? ""),
      created: new Date(String(r.created_at)).toLocaleString(),
      expires: r.expires_at
        ? new Date(String(r.expires_at)).toLocaleString()
        : "",
      serial: String(r.serial ?? ""),
      location: String(r.location ?? ""),
      provider: String(r.provider ?? ""),
      reference: String(r.merchant_reference ?? r.event_reference ?? ""),
      environment: String(r.environment ?? ""),
      language: r.language === "he" ? "Hebrew" : "English",
      body: String(r.body ?? "").slice(0, 100),
      summary: r.daily_summary ? "Requested" : "Off",
      failed: r.failed_payment_notices ? "Requested" : "Off",
      hour: Number(r.schedule_hour ?? 0),
      retries: Number(r.retry_limit ?? 0),
      event: String(r.event ?? ""),
      minimum: currency(r.min_amount_minor),
      action: String(r.action ?? ""),
      details: String(r.details ?? ""),
      error: String(r.error ?? ""),
      status:
        page === "automations"
          ? r.active
            ? "Enabled"
            : "Disabled"
          : page === "invitations"
            ? r.accepted_at
              ? "Accepted"
              : String(r.expires_at) < new Date().toISOString()
                ? "Expired"
                : "Pending"
            : page === "notifications"
              ? "Setup required"
              : String(r.status ?? ""),
    }));
  } else if (page === "accounts") {
    keys = {
      code: "Code",
      name: "Account",
      type: "Type",
      purpose: "Purpose",
      balance: "Balance",
    };
    rows = view(t.accounts, (r) => ({
      code: String(r.code),
      name: String(r.name),
      type: String(r.kind),
      purpose: String(r.purpose),
      balance: currency(
        accountBalance(data, r.id) *
          (["asset", "expense"].includes(String(r.kind)) ? 1 : -1),
      ),
    }));
  } else if (page === "transactions") {
    keys = {
      date: "Date",
      description: "Description",
      source: "Source",
      debits: "Debits",
      credits: "Credits",
      status: "Status",
    };
    rows = view(t.journal_entries, (r) => ({
      date: String(r.entry_date),
      description: String(r.description),
      source: String(r.source),
      debits: currency(
        sum(
          t.journal_lines.filter((l) => l.entry_id === r.id),
          "debit_minor",
        ),
      ),
      credits: currency(
        sum(
          t.journal_lines.filter((l) => l.entry_id === r.id),
          "credit_minor",
        ),
      ),
      status: "Posted",
    }));
  } else if (page === "vendors") {
    keys = {
      name: "Vendor",
      contact: "Contact",
      email: "Email",
      phone: "Phone",
      balance: "Outstanding balance",
    };
    rows = view(t.vendors, (r) => {
      const bills = t.bills.filter((b) => b.vendor_id === r.id),
        ids = bills.map((b) => b.id);
      return {
        name: String(r.name),
        contact: String(r.contact ?? ""),
        email: String(r.email ?? ""),
        phone: String(r.phone ?? ""),
        balance: currency(
          sum(bills, "amount_minor") -
            sum(
              t.bill_payments.filter((p) => ids.includes(String(p.bill_id))),
              "amount_minor",
            ),
        ),
      };
    });
  } else if (page === "bills") {
    keys = {
      vendor: "Vendor",
      reference: "Invoice",
      date: "Bill date",
      due: "Due date",
      amount: "Amount",
      paid: "Payments",
      open: "Balance",
      status: "Status",
    };
    rows = view(t.bills, (r) => {
      const paid = sum(
          t.bill_payments.filter((p) => p.bill_id === r.id),
          "amount_minor",
        ),
        open = Number(r.amount_minor) - paid;
      return {
        vendor: name("vendors", r.vendor_id),
        reference: String(r.invoice_reference),
        date: String(r.bill_date),
        due: String(r.due_date),
        amount: currency(r.amount_minor),
        paid: currency(paid),
        open: currency(open),
        status:
          open === 0
            ? "Paid"
            : String(r.due_date) < today()
              ? "Overdue"
              : "Open",
      };
    });
  } else if (page === "checks") {
    keys = {
      number: "Check number",
      payee: "Payee",
      bank: "Bank account",
      date: "Date",
      amount: "Amount",
      memo: "Memo",
    };
    rows = view(
      t.bill_payments.filter((p) => p.method === "check"),
      (r) => {
        const bill = t.bills.find((b) => b.id === r.bill_id);
        return {
          number: String(r.check_number),
          payee: name("vendors", bill?.vendor_id),
          bank: name("accounts", r.bank_account_id),
          date: String(r.paid_on),
          amount: currency(r.amount_minor),
          memo: String(r.memo ?? ""),
        };
      },
    );
  } else if (page === "bank") {
    keys = {
      date: "Date",
      bank: "Bank account",
      description: "Description",
      reference: "Bank ID",
      amount: "Amount",
      entry: "Ledger match",
      status: "Status",
    };
    rows = view(t.bank_transactions, (r) => ({
      date: String(r.transaction_date),
      bank: name("accounts", r.bank_account_id),
      description: String(r.description),
      reference: String(r.external_id),
      amount: currency(r.amount_minor),
      entry: String(
        t.journal_entries.find((e) => e.id === r.entry_id)?.description ?? "—",
      ),
      status: String(r.status),
    }));
  } else if (page === "reconciliation") {
    keys = {
      bank: "Bank account",
      date: "Statement ending",
      start: "Starting balance",
      ending: "Ending balance",
      cleared: "Cleared entries",
      status: "Status",
    };
    rows = view(t.reconciliations, (r) => ({
      bank: name("accounts", r.bank_account_id),
      date: String(r.statement_date),
      start: currency(r.starting_balance_minor),
      ending: currency(r.ending_balance_minor),
      cleared: t.reconciliation_items.filter(
        (i) => i.reconciliation_id === r.id,
      ).length,
      status: "Reconciled",
    }));
  } else if (page === "imports") {
    keys = {
      name: "Import",
      date: "Run date",
      added: "Added",
      updated: "Updated",
      failed: "Failed",
      status: "Result",
    };
    rows = view(t.import_runs, (r) => ({
      name: String(r.name),
      date: new Date(String(r.created_at)).toLocaleString(),
      added: Number(r.added),
      updated: Number(r.updated),
      failed: Number(r.failed),
      status: Number(r.failed) > 0 ? "Partial" : "Completed",
    }));
  } else if (page === "donors") {
    keys = {
      name: "Donor",
      hebrew: "Hebrew name",
      email: "Email",
      tags: "Tags",
      pledged: "Total pledged",
      paid: "Paid",
      scheduled: "On plans",
      open: "Open balance",
      credit: "Credit",
    };
    rows = view(t.donors, (d) => {
      const totals = donorTotals(data, d.id);
      return {
        name: String(d.name),
        hebrew: String(d.hebrew_name ?? ""),
        email: String(d.email ?? ""),
        tags: ((d.tags as string[]) ?? []).join(", "),
        pledged: currency(totals.pledged),
        paid: currency(totals.paid),
        scheduled: currency(totals.scheduled),
        open: currency(totals.open),
        credit: currency(totals.credit),
      };
    });
  } else if (page === "pledges") {
    keys = {
      id: "Pledge ID",
      donor: "Donor",
      date: "Pledge date",
      amount: "Pledged",
      campaign: "Campaign",
      fundraiser: "Fundraiser",
      paid: "Paid",
      scheduled: "On Plan",
      open: "Open balance",
      due: "Due date",
      status: "Status",
    };
    keys = { ...keys, ...extraColumns, id: "Pledge ID", type: "Type" };
    rows = view(t.pledges, (p) => ({
      ...donorColumns(p),
      type: p.source_type === "direct_donation" ? "Donation" : "Pledge",
      donor: name("donors", p.donor_id),
      date: String(p.pledged_on),
      amount: currency(p.amount_minor),
      campaign: name("campaigns", p.campaign_id),
      fundraiser: name("fundraisers", p.fundraiser_id),
      paid: currency(paid(data, p.id)),
      scheduled: currency(scheduled(data, p.id)),
      open: currency(balance(data, p)),
      due: String(p.due_date),
      status: p.voided_at
        ? "Void"
        : balance(data, p) === 0
          ? "Paid"
          : String(p.due_date) < today()
            ? "Overdue"
            : scheduled(data, p.id) > 0
              ? "On plan"
              : "Open",
    }));
  } else if (page === "payments") {
    keys = {
      donor: "Donor",
      date: "Payment date",
      amount: "Amount",
      method: "Method",
      reference: "Reference",
      allocated: "Allocated",
      credit: "Available credit",
      deposit: "Deposit status",
      status: "Status",
    };
    keys = {
      ...keys,
      campaign: "Campaign",
      fundraiser: "Fundraiser",
      ...extraColumns,
      id: "Payment ID",
      collector: "Collector",
      provider: "Payment provider",
      processed: "Processed Status",
    };
    rows = view(t.payments, (p) => ({
      ...donorColumns(p),
      type: "Payment",
      campaign: [
        ...new Set([
          ...t.payment_allocations
            .filter((a) => a.payment_id === p.id)
            .map((a) =>
              name(
                "campaigns",
                t.pledges.find((pl) => pl.id === a.pledge_id)?.campaign_id,
              ),
            ),
          ...(credit(data, p) > 0 ||
          !t.payment_allocations.some((a) => a.payment_id === p.id)
            ? [name("campaigns", p.campaign_id)]
            : []),
        ]),
      ].join(" · "),
      fundraiser: name("fundraisers", p.fundraiser_id),
      collector: String(p.collector ?? ""),
      processed: String(p.status),
      provider:
        p.provider === "matbia"
          ? p.environment === "simulation"
            ? "Matbia · simulated"
            : "Matbia"
          : p.provider === "sola"
            ? "Sola"
            : "Manual / external",
      donor: name("donors", p.donor_id),
      date: String(p.paid_on),
      amount: currency(p.amount_minor),
      method: String(p.method).replaceAll("_", " "),
      reference: String(p.reference ?? "—"),
      allocated: currency(
        sum(
          t.payment_allocations.filter((a) => a.payment_id === p.id),
          "amount_minor",
        ),
      ),
      credit: currency(credit(data, p)),
      deposit: String(p.deposit_status),
      status: String(p.status),
    }));
  } else if (
    page === "campaigns" ||
    page === "fundraisers" ||
    page === "sponsorships"
  ) {
    keys = {
      name: pageTitles[page].replace(/s$/, ""),
      ...(page === "campaigns" ? { fund: "Fund", goal: "Goal" } : {}),
      raised: "Raised",
      paid: "Paid",
      scheduled: "Scheduled",
      outstanding: "Outstanding",
      ...(page === "fundraisers" ? { donors: "Assigned donors" } : {}),
      ...(page === "sponsorships"
        ? { available: "Available", price: "Default price" }
        : {}),
      status: "Status",
    };
    rows = view(t[page], (r) => {
      const key =
          page === "campaigns"
            ? "campaign_id"
            : page === "fundraisers"
              ? "fundraiser_id"
              : "sponsorship_id",
        pledges = t.pledges.filter((p) => p[key] === r.id && !p.voided_at);
      return {
        name: String(r.name),
        fund: name("funds", r.fund_id),
        goal: currency(r.goal_minor),
        raised: currency(sum(pledges, "amount_minor")),
        paid: currency(pledges.reduce((n, p) => n + paid(data, p.id), 0)),
        scheduled: currency(
          pledges.reduce((n, p) => n + scheduled(data, p.id), 0),
        ),
        outstanding: currency(
          pledges.reduce((n, p) => n + balance(data, p), 0),
        ),
        donors: t.donors.filter((d) => d.fundraiser_id === r.id).length,
        available: Math.max(
          0,
          Number(r.availability_limit ?? 0) - pledges.length,
        ),
        price: currency(r.default_price_minor),
        status: String(r.status ?? "active"),
      };
    });
  } else if (page === "schedules") {
    keys = {
      donor: "Donor",
      type: "Type",
      frequency: "Frequency",
      start: "Start date",
      total: "Total plan",
      remaining: "Remaining",
      next: "Next due",
      status: "Status",
      errors: "Errors",
    };
    rows = view(t.schedules, (s) => {
      const open = t.installments
        .filter((i) => i.schedule_id === s.id && !i.payment_id)
        .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
      return {
        donor: name("donors", s.donor_id),
        type: String(s.kind),
        frequency: String(s.frequency),
        start: String(s.start_date),
        total: currency(s.total_minor),
        remaining: open.length,
        next: String(open[0]?.due_date ?? "—"),
        status: String(s.status),
        errors: String(s.error || "None"),
      };
    });
  } else if (page === "receipts") {
    keys = {
      number: "Receipt",
      donor: "Donor",
      date: "Payment date",
      amount: "Amount",
      language: "Language",
      status: "Delivery",
    };
    rows = view(t.receipts, (r) => {
      const snap = r.snapshot as Record<string, unknown>;
      return {
        number: `RCPT-${String(r.number).padStart(6, "0")}`,
        donor: String(snap.donor),
        date: String(snap.paid_on),
        amount: currency(snap.amount_minor),
        language: r.language === "he" ? "Hebrew" : "English",
        status: r.voided_at ? "Voided" : "Print-ready · not emailed",
      };
    });
  } else if (page === "donor_accounts") {
    keys = {
      name: "Account name",
      display: "Display name",
      donor: "Linked donor",
      type: "Type",
      email: "Email",
      address: "Address",
    };
    rows = view(t.donor_accounts, (r) => ({
      name: String(r.name),
      display: String(r.display_name),
      donor: name("donors", r.donor_id),
      type: String(r.type),
      email: String(r.email ?? ""),
      address: String(r.address ?? ""),
    }));
  } else if (page === "donor_lists") {
    keys = { name: "List", members: "Members" };
    rows = view(t.donor_lists, (r) => ({
      name: String(r.name),
      members: t.list_members.filter((m) => m.list_id === r.id).length,
    }));
  } else if (page === "events") {
    keys = {
      name: "Event",
      date: "Date",
      description: "Description",
      pledged: "Pledged",
      status: "Status",
    };
    rows = view(t.events, (r) => ({
      name: String(r.name),
      date: String(r.event_date),
      description: String(r.description),
      pledged: currency(
        sum(
          t.pledges.filter((p) => p.event_id === r.id),
          "amount_minor",
        ),
      ),
      status: String(r.status),
    }));
  } else if (page === "tasks") {
    keys = {
      subject: "Subject",
      donor: "Donor",
      assignee: "Assignee",
      due: "Due date",
      priority: "Priority",
      status: "Status",
    };
    rows = view(t.tasks, (r) => ({
      subject: String(r.subject),
      donor: name("donors", r.donor_id),
      assignee: String(r.assignee ?? "Unassigned"),
      due: String(r.due_date),
      priority: String(r.priority),
      status: String(r.status),
    }));
  } else if (page === "activities") {
    keys = {
      date: "Date & time",
      donor: "Donor",
      type: "Activity",
      details: "Details",
      user: "Responsible user",
    };
    rows = view([...t.activities].reverse(), (r) => ({
      date: new Date(String(r.created_at)).toLocaleString("en-US", {
        timeZone: String(data.organization.timezone ?? "America/New_York"),
      }),
      donor: name("donors", r.donor_id),
      type: String(r.type),
      details: String(r.details),
      user: String(r.responsible_user ?? "Organization user"),
    }));
  } else if (page === "funds") {
    keys = {
      name: "Fund",
      restriction: "Restriction",
      pledged: "Pledged",
      outstanding: "Outstanding",
    };
    rows = view(t.funds, (r) => {
      const campaigns = t.campaigns
          .filter((c) => c.fund_id === r.id)
          .map((c) => c.id),
        pledges = t.pledges.filter((p) =>
          campaigns.includes(String(p.campaign_id)),
        );
      return {
        name: String(r.name),
        restriction: r.restricted ? "Restricted" : "Unrestricted",
        pledged: currency(sum(pledges, "amount_minor")),
        outstanding: currency(
          pledges.reduce((n, p) => n + balance(data, p), 0),
        ),
      };
    });
  }
  return {
    columns: Object.entries(keys).map(([key, label]) => ({
      key,
      label,
      defaultHidden:
        ["pledges", "payments"].includes(page) &&
        ![
          "id",
          "donor",
          "date",
          "type",
          "amount",
          "status",
          "paid",
          "scheduled",
          "open",
          "campaign",
          "fundraiser",
          "description",
          ...(page === "payments" ? ["method", "reference", "credit"] : []),
        ].includes(key),
    })),
    rows,
  };
}

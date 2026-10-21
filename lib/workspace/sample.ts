import {
  applyCommand,
  tableNames,
  today,
  accountId,
  accountBalance,
  type WorkspaceData,
  type Row,
} from "./domain";

export function sampleData(): WorkspaceData {
  const organization = {
    id: crypto.randomUUID(),
    name: "Fundora Demo Community",
    hebrew_name: "קהילת ארז וזית",
    currency: "USD",
    timezone: "America/New_York",
    tax_id: "",
  };
  let data: WorkspaceData = {
    organization,
    role: "owner",
    tables: Object.fromEntries(tableNames.map((t) => [t, []])),
  };
  const insert = (table: string, values: Record<string, unknown>) => {
    data = applyCommand(data, { type: "insert", table, values });
    return data.tables[table].at(-1)!;
  };
  insert("automation_rules", {
    name: "Follow up on failed donations",
    event: "payment_failed",
    action: "create_task",
    min_amount_minor: 0,
    subject: "Review failed donation with donor",
    active: true,
  });
  insert("devices", {
    name: "Lobby donation station",
    serial: "SAMPLE-DEVICE-001",
    location: "Main lobby",
    provider: "Provider selection pending",
    status: "setup_required",
  });
  insert("gateway_accounts", {
    name: "Solo sandbox setup",
    provider: "Solo",
    merchant_reference: "SAMPLE-NOT-A-MERCHANT",
    environment: "sandbox",
    status: "setup_required",
  });
  insert("document_templates", {
    name: "Community thank-you",
    language: "en",
    body: "Dear {{donor}}, thank you for your support of {{organization}}. We recorded {{amount}} on {{date}}.",
  });
  const dates = (offset: number) => {
    const date = new Date(`${today()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const general = insert("funds", { name: "General fund", restricted: false }),
    education = insert("funds", {
      name: "Torah & education",
      restricted: true,
    }),
    care = insert("funds", { name: "Community care", restricted: true });
  const fundraisers = ["Rabbi Daniel Levy", "Miriam Rosen", "David Stein"].map(
    (name, i) =>
      insert("fundraisers", { name, email: `fundraiser${i + 1}@example.test` }),
  );
  const campaigns = [
    insert("campaigns", {
      name: "Annual community appeal",
      fund_id: general.id,
      goal_minor: 15000000,
      status: "active",
    }),
    insert("campaigns", {
      name: "A brighter year of learning",
      fund_id: education.id,
      goal_minor: 7500000,
      status: "active",
    }),
    insert("campaigns", {
      name: "Neighbors helping neighbors",
      fund_id: care.id,
      goal_minor: 5000000,
      status: "active",
    }),
  ];
  const names = [
    ["Ari & Sarah Goldstein", "אריה ושרה גולדשטיין"],
    ["Miriam Cohen", "מרים כהן"],
    ["David & Rachel Weiss", "דוד ורחל וייס"],
    ["The Friedman Family", "משפחת פרידמן"],
    ["Moshe Klein", "משה קליין"],
    ["Esther Rosenberg", "אסתר רוזנברג"],
    ["Ben & Leah Adler", "בנימין ולאה אדלר"],
    ["Jacob Stein", "יעקב שטיין"],
    ["Rebecca Miller", "רבקה מילר"],
    ["Samuel Katz", "שמואל כץ"],
    ["Hannah Green", "חנה גרין"],
    ["Isaac Berger", "יצחק ברגר"],
    ["Rose Community Foundation", ""],
    ["Daniel & Chana Levy", "דניאל וחנה לוי"],
    ["Aaron Schwartz", "אהרן שוורץ"],
    ["Naomi Segal", "נעמי סגל"],
  ];
  names.forEach(([name, hebrew_name], i) => {
    const d = insert("donors", {
      name,
      hebrew_name,
      title: i % 3 ? "Mr. & Mrs." : "",
      email: `donor${i + 1}@example.test`,
      emails: [`donor${i + 1}@example.test`],
      phones: [`202-555-${String(100 + i).padStart(4, "0")}`],
      addresses: [
        {
          type: "personal",
          address: `${100 + i} Example Avenue, Brooklyn, NY 11201`,
        },
      ],
      tags: i % 3 === 0 ? ["Major donor", "Member"] : ["Member"],
      notes: "Synthetic sample record. Not a real donor.",
      receipt_language: i % 4 === 0 ? "he" : "en",
      fundraiser_id: fundraisers[i % 3].id,
      occasions: [],
      custom_fields: {},
    });
    const amount = [
      500000, 180000, 360000, 1000000, 72000, 250000, 540000, 18000,
    ][i % 8];
    const p = insert("pledges", {
      donor_id: d.id,
      campaign_id: campaigns[i % 3].id,
      fundraiser_id: fundraisers[i % 3].id,
      amount_minor: amount,
      pledged_on: dates(-80 + i * 4),
      due_date: dates(-10 + i * 3),
      description: "Community appeal commitment",
      receipt_requested: true,
    });
    if (i % 4 !== 3) {
      const paymentAmount =
        i % 4 === 0 ? amount + 18000 : Math.floor(amount / 2);
      data = applyCommand(data, {
        type: "payment",
        values: {
          donor_id: d.id,
          amount_minor: paymentAmount,
          paid_on: dates(-65 + i * 4),
          method: i % 2 ? "check" : "bank_transfer",
          status: "processed",
          reference: `SAMPLE-${1001 + i}`,
          idempotency_key: crypto.randomUUID(),
          allocations: [
            { pledge_id: p.id, amount_minor: Math.min(paymentAmount, amount) },
          ],
        },
      });
      if (i % 3 === 0)
        data = applyCommand(data, {
          type: "receipt",
          values: { payment: data.tables.payments.at(-1)!.id },
        });
    }
    if (i % 4 === 1)
      data = applyCommand(data, {
        type: "schedule",
        values: {
          pledge: p.id,
          total: Math.floor(amount / 2),
          count: 3,
          first_date: dates(3 + i),
          schedule_kind: "installment",
          schedule_frequency: "monthly",
        },
      });
    if (i % 4 === 2)
      data = applyCommand(data, {
        type: "payment",
        values: {
          donor_id: d.id,
          amount_minor: 18000,
          paid_on: dates(-i),
          method: "external_card",
          status: i === 2 ? "failed" : "pending",
          reference: `SAMPLE-ATTEMPT-${i}`,
          idempotency_key: crypto.randomUUID(),
          allocations: [],
        },
      });
  });
  const donors = data.tables.donors;
  const list = insert("donor_lists", { name: "Annual appeal committee" });
  donors
    .slice(0, 5)
    .forEach((d) =>
      insert("list_members", { list_id: list.id, donor_id: d.id }),
    );
  insert("donor_accounts", {
    donor_id: donors[0].id,
    name: "Goldstein Family Giving",
    display_name: "Goldstein Family",
    type: "foundation",
    email: "giving@example.test",
    address: "100 Example Avenue, Brooklyn, NY 11201",
  });
  insert("events", {
    name: "Community appreciation evening",
    description: "A sample gathering celebrating our volunteers.",
    event_date: dates(20),
    status: "planned",
  });
  insert("sponsorships", {
    name: "Weekly kiddush",
    type: "Kiddush",
    availability_limit: 52,
    default_price_minor: 36000,
  });
  [
    ["Follow up on annual pledge", -2, "high"],
    ["Send campaign update", 2, "normal"],
    ["Discuss dedication opportunity", 5, "normal"],
  ].forEach(([subject, day, priority], i) =>
    insert("tasks", {
      subject,
      donor_id: donors[i].id,
      due_date: dates(Number(day)),
      priority,
      assignee: fundraisers[i].name,
      status: "open",
      description: "Sample follow-up task",
    }),
  );
  const bank = accountId(data, "1000");
  data = applyCommand(data, {
    type: "journal",
    values: {
      dated: dates(-100),
      memo: "Opening bank balance",
      request_key: crypto.randomUUID(),
      lines: [
        { account_id: bank, debit_minor: 1000000 },
        { account_id: accountId(data, "3000"), credit_minor: 1000000 },
      ],
    },
  });
  const deposits = data.tables.payments
    .filter((p) => p.status === "processed")
    .slice(0, 4);
  data = applyCommand(data, {
    type: "deposit",
    values: {
      bank,
      dated: dates(-1),
      payments: deposits.map((p) => p.id),
      request_key: crypto.randomUUID(),
    },
  });
  const depositEntry = data.tables.journal_entries.at(-1)!;
  const vendor = insert("vendors", {
    name: "Brooklyn Community Supplies",
    contact: "Sample vendor contact",
    email: "supplies@example.test",
    phone: "202-555-0198",
    address: "200 Example Street, Brooklyn, NY",
  });
  data = applyCommand(data, {
    type: "bill",
    values: {
      vendor: vendor.id,
      invoice: "SAMPLE-INV-101",
      dated: dates(-8),
      due: dates(10),
      amount: 54000,
      expense_account: accountId(data, "5000"),
      fund: education.id,
      memo: "Learning materials for the community program",
    },
  });
  const bill = data.tables.bills.at(-1)!;
  data = applyCommand(data, {
    type: "pay_bill",
    values: {
      bill: bill.id,
      bank,
      amount: 18000,
      dated: dates(-2),
      payment_method: "check",
      check_reference: "SAMPLE-1001",
      memo: "Program supplies installment",
      request_key: crypto.randomUUID(),
    },
  });
  data = applyCommand(data, {
    type: "bank_import",
    values: {
      bank,
      import_name: "sample-bank.csv",
      rows: [
        {
          external_id: "SAMPLE-DEP-001",
          transaction_date: dates(-1),
          description: "Community donation deposit",
          amount_minor: deposits.reduce(
            (n, p) => n + Number(p.amount_minor),
            0,
          ),
        },
        {
          external_id: "SAMPLE-FEE-001",
          transaction_date: dates(-1),
          description: "Monthly bank service charge",
          amount_minor: -1500,
        },
        {
          external_id: "SAMPLE-OTHER-001",
          transaction_date: dates(0),
          description: "Unmatched incoming transfer — review required",
          amount_minor: 18000,
        },
      ],
    },
  });
  data = applyCommand(data, {
    type: "bank_match",
    values: {
      bank_transaction: data.tables.bank_transactions[0].id,
      entry: depositEntry.id,
    },
  });
  data = applyCommand(data, {
    type: "bank_create",
    values: {
      bank_transaction: data.tables.bank_transactions[1].id,
      category: accountId(data, "5200"),
      fund: general.id,
    },
  });
  const cleared = data.tables.journal_entries
    .filter(
      (e) =>
        String(e.entry_date) <= dates(-1) &&
        data.tables.journal_lines.some(
          (l) => l.entry_id === e.id && l.account_id === bank,
        ),
    )
    .map((e) => e.id);
  data = applyCommand(data, {
    type: "reconcile",
    values: {
      bank,
      statement_date: dates(-1),
      ending_balance: accountBalance(data, bank, dates(-1)),
      entries: cleared,
    },
  });
  return data;
}

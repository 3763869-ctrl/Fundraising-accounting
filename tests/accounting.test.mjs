import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("accounting postings, deposits, bills, bank matching, and reconciliation", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`,
    );
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    await db.query(
      "select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)",
    );
    await db.exec("set role authenticated");
    const org = (await db.query("select create_organization('Ledger test') id"))
      .rows[0].id;
    const accounts = (await db.query("select id,code from accounts")).rows;
    const account = (code) => accounts.find((a) => a.code === code).id;
    const acctBalance = async (code) =>
      Number(
        (
          await db.query(
            "select coalesce(sum(debit_minor-credit_minor),0) amount from journal_lines where account_id=$1",
            [account(code)],
          )
        ).rows[0].amount,
      );
    const donor = (
      await db.query(
        "insert into donors(organization_id,name) values($1,'Test donor') returning id",
        [org],
      )
    ).rows[0].id;
    const campaign = (
      await db.query(
        "insert into campaigns(organization_id,name) values($1,'Appeal') returning id",
        [org],
      )
    ).rows[0].id;
    const pledge = (
      await db.query(
        "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values($1,$2,$3,15000,'2026-12-31') returning id",
        [org, donor, campaign],
      )
    ).rows[0].id;
    let payment, deposit, bill;
    await t.test(
      "commitments do not post income until explicitly recognized or paid",
      async () => {
        assert.equal(await acctBalance("4000"), 0);
        assert.equal(await acctBalance("1100"), 0);
        await db.query("select recognize_pledge($1,'2026-10-01')", [pledge]);
        assert.equal(await acctBalance("1100"), 15000);
        assert.equal(await acctBalance("4000"), -15000);
        await assert.rejects(
          db.query("select recognize_pledge($1,'2026-10-01')", [pledge]),
        );
      },
    );
    await t.test(
      "received payments and allocations post balanced entries and preserve credit",
      async () => {
        payment = (
          await db.query(
            "select record_payment($1,$2,18000,'2026-10-02','check','processed','TEST',$3,$4::jsonb) id",
            [
              org,
              donor,
              randomUUID(),
              JSON.stringify([{ pledge_id: pledge, amount_minor: 15000 }]),
            ],
          )
        ).rows[0].id;
        assert.equal(await acctBalance("1050"), 18000);
        assert.equal(await acctBalance("2100"), -3000);
        assert.equal(await acctBalance("1100"), 0);
        assert.equal(await acctBalance("4000"), -15000);
        assert.equal(
          Number(
            (
              await db.query(
                "select sum(debit_minor-credit_minor) n from journal_lines",
              )
            ).rows[0].n,
          ),
          0,
        );
      },
    );
    await t.test(
      "deposit transfers assets without double-counting contribution revenue",
      async () => {
        const income = await acctBalance("4000");
        deposit = (
          await db.query(
            "select deposit_payments($1,$2,'2026-10-03',$3::uuid[],$4) id",
            [org, account("1000"), [payment], randomUUID()],
          )
        ).rows[0].id;
        assert.equal(await acctBalance("1000"), 18000);
        assert.equal(await acctBalance("1050"), 0);
        assert.equal(await acctBalance("4000"), income);
        await assert.rejects(
          db.query(
            "select deposit_payments($1,$2,'2026-10-03',$3::uuid[],$4)",
            [org, account("1000"), [payment], randomUUID()],
          ),
        );
      },
    );
    await t.test(
      "manual journals reject imbalance and direct client modification",
      async () => {
        const lines = [
          { account_id: account("1000"), debit_minor: 100 },
          { account_id: account("3000"), credit_minor: 99 },
        ];
        await assert.rejects(
          db.query(
            "select post_manual_journal($1,'2026-10-03','Unbalanced',$2,$3::jsonb)",
            [org, randomUUID(), JSON.stringify(lines)],
          ),
        );
        await assert.rejects(
          db.query(
            "update journal_lines set debit_minor=1 where debit_minor>0",
          ),
        );
        await assert.rejects(db.query("delete from journal_entries"));
        const key = randomUUID();
        lines[1].credit_minor = 100;
        const first = (
          await db.query(
            "select post_manual_journal($1,'2026-10-03','Opening adjustment',$2,$3::jsonb) id",
            [org, key, JSON.stringify(lines)],
          )
        ).rows[0].id;
        assert.equal(
          (
            await db.query(
              "select post_manual_journal($1,'2026-10-03','Opening adjustment',$2,$3::jsonb) id",
              [org, key, JSON.stringify(lines)],
            )
          ).rows[0].id,
          first,
        );
        lines[0].debit_minor = 200;
        lines[1].credit_minor = 200;
        await assert.rejects(
          db.query(
            "select post_manual_journal($1,'2026-10-03','Opening adjustment',$2,$3::jsonb)",
            [org, key, JSON.stringify(lines)],
          ),
        );
      },
    );
    await t.test(
      "bills create payables; partial payments cannot overpay or reuse check numbers",
      async () => {
        const vendor = (
          await db.query(
            "insert into vendors(organization_id,name) values($1,'Test supplies') returning id",
            [org],
          )
        ).rows[0].id;
        bill = (
          await db.query(
            "select create_bill($1,$2,'INV-101','2026-10-03','2026-11-03',10000,$3,null,'Supplies') id",
            [org, vendor, account("5000")],
          )
        ).rows[0].id;
        assert.equal(await acctBalance("2000"), -10000);
        assert.equal(await acctBalance("5000"), 10000);
        await db.query(
          "select pay_bill($1,$2,4000,'2026-10-04','check','1001','Supplies installment',$3)",
          [bill, account("1000"), randomUUID()],
        );
        assert.equal(await acctBalance("2000"), -6000);
        assert.equal(await acctBalance("1000"), 14100);
        await assert.rejects(
          db.query(
            "select pay_bill($1,$2,6001,'2026-10-04','bank_transfer','','',$3)",
            [bill, account("1000"), randomUUID()],
          ),
        );
        await assert.rejects(
          db.query(
            "select pay_bill($1,$2,100,'2026-10-04','check','1001','Duplicate',$3)",
            [bill, account("1000"), randomUUID()],
          ),
        );
      },
    );
    let bankRow;
    await t.test(
      "bank imports log invalid rows and skip duplicate IDs",
      async () => {
        const rows = [
          {
            external_id: "DEP-1",
            transaction_date: "2026-10-03",
            description: "Deposit",
            amount_minor: 18000,
          },
          {
            external_id: "FEE-1",
            transaction_date: "2026-10-05",
            description: "Bank fee",
            amount_minor: -500,
          },
          {
            external_id: "BAD",
            transaction_date: "not-a-date",
            description: "Invalid",
            amount_minor: 100,
          },
        ];
        const r = (
          await db.query("select import_bank_rows($1,$2,$3,$4::jsonb) result", [
            org,
            account("1000"),
            "statement.csv",
            JSON.stringify(rows),
          ])
        ).rows[0].result;
        assert.equal(r.added, 2);
        assert.equal(r.failed, 1);
        const second = (
          await db.query("select import_bank_rows($1,$2,$3,$4::jsonb) result", [
            org,
            account("1000"),
            "statement.csv",
            JSON.stringify(rows.slice(0, 2)),
          ])
        ).rows[0].result;
        assert.equal(second.duplicates, 2);
        bankRow = (
          await db.query(
            "select id from bank_transactions where external_id='DEP-1'",
          )
        ).rows[0].id;
      },
    );
    await t.test(
      "matching a deposit creates no new accounting entries",
      async () => {
        const count = (await db.query("select count(*) n from journal_entries"))
          .rows[0].n;
        await db.query("select match_bank_transaction($1,$2)", [
          bankRow,
          deposit,
        ]);
        assert.equal(
          (await db.query("select count(*) n from journal_entries")).rows[0].n,
          count,
        );
        await assert.rejects(
          db.query("select match_bank_transaction($1,$2)", [bankRow, deposit]),
        );
        const fee = (
          await db.query(
            "select id from bank_transactions where external_id='FEE-1'",
          )
        ).rows[0].id;
        await db.query("select create_bank_entry($1,$2,null)", [
          fee,
          account("5200"),
        ]);
        assert.equal(await acctBalance("5200"), 500);
        assert.equal(await acctBalance("1000"), 13600);
      },
    );
    await t.test(
      "reconciliation requires zero difference, cannot reuse entries, and locks backdating",
      async () => {
        const entries = (
          await db.query(
            "select distinct entry_id id from journal_lines where account_id=$1",
            [account("1000")],
          )
        ).rows.map((r) => r.id);
        await assert.rejects(
          db.query(
            "select reconcile_bank($1,$2,'2026-10-06',13599,$3::uuid[])",
            [org, account("1000"), entries],
          ),
        );
        await db.query(
          "select reconcile_bank($1,$2,'2026-10-06',13600,$3::uuid[])",
          [org, account("1000"), entries],
        );
        await assert.rejects(
          db.query(
            "select reconcile_bank($1,$2,'2026-10-07',13600,$3::uuid[])",
            [org, account("1000"), entries],
          ),
        );
        await assert.rejects(
          db.query(
            "select post_manual_journal($1,'2026-10-05','Backdated',$2,$3::jsonb)",
            [
              org,
              randomUUID(),
              JSON.stringify([
                { account_id: account("1000"), debit_minor: 100 },
                { account_id: account("3000"), credit_minor: 100 },
              ]),
            ],
          ),
        );
      },
    );
    await t.test(
      "accounting records and writer functions remain organization isolated",
      async () => {
        await db.exec("reset role");
        await db.query(
          "select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)",
        );
        await db.exec("set role authenticated");
        assert.equal(
          (await db.query("select * from journal_lines")).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "select pay_bill($1,$2,100,'2026-10-07','bank_transfer','','',$3)",
            [bill, account("1000"), randomUUID()],
          ),
        );
        await assert.rejects(db.query("select initialize_accounts($1)", [org]));
      },
    );
  } finally {
    await db.close();
  }
});

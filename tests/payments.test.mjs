import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("payment, credit, schedule, receipt, and batch workflows", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated; insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');`,
    );
    await db.exec(`create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(path text) returns text[] language sql immutable as $$ select string_to_array(path,'/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated;
      grant select,insert,delete on storage.objects to authenticated;
    `);
    for (const file of [
      "202610190001_foundation.sql",
      "202610190002_fundraising.sql",
      "202610190003_contact_management.sql",
      "202610190004_attachments.sql",
      "202610190005_accounting.sql",
      "202610190006_banking.sql",
    ])
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const actor = async (n) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      ]);
      await db.exec("set role authenticated");
    };
    await actor(1);
    const org = (
      await db.query("select create_organization('Test charity') id")
    ).rows[0].id;
    const donor = (
      await db.query(
        "insert into donors(organization_id,name) values($1,'Test donor') returning id",
        [org],
      )
    ).rows[0].id;
    const otherDonor = (
      await db.query(
        "insert into donors(organization_id,name) values($1,'Different donor') returning id",
        [org],
      )
    ).rows[0].id;
    const campaign = (
      await db.query(
        "insert into campaigns(organization_id,name) values($1,'Appeal') returning id",
        [org],
      )
    ).rows[0].id;
    const pledge = async (amount = 10000, d = donor) =>
      (
        await db.query(
          "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values($1,$2,$3,$4,'2027-01-01') returning id",
          [org, d, campaign, amount],
        )
      ).rows[0].id;
    const p1 = await pledge(),
      p2 = await pledge(),
      p3 = await pledge(10001);
    const payment = async (
      amount,
      allocations = [],
      key = randomUUID(),
      status = "processed",
      installment = null,
      d = donor,
    ) =>
      (
        await db.query(
          "select record_payment($1,$2,$3,'2026-10-19','check',$4,'REF',$5,$6::jsonb,$7) id",
          [
            org,
            d,
            amount,
            status,
            key,
            JSON.stringify(allocations),
            installment,
          ],
        )
      ).rows[0].id;
    const total = async (table) =>
      (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
    let firstPayment;
    await t.test(
      "one payment covers multiple pledges and keeps excess as credit",
      async () => {
        firstPayment = await payment(25000, [
          { pledge_id: p1, amount_minor: 10000 },
          { pledge_id: p2, amount_minor: 5000 },
        ]);
        const amounts = (
          await db.query(
            "select p.amount_minor-coalesce(sum(a.amount_minor),0) credit from payments p left join payment_allocations a on a.payment_id=p.id where p.id=$1 group by p.id",
            [firstPayment],
          )
        ).rows[0];
        assert.equal(Number(amounts.credit), 10000);
        await db.query("select allocate_payment($1,$2::jsonb)", [
          firstPayment,
          JSON.stringify([{ pledge_id: p2, amount_minor: 5000 }]),
        ]);
        assert.equal(
          Number(
            (
              await db.query(
                "select sum(amount_minor) n from payment_allocations where payment_id=$1",
                [firstPayment],
              )
            ).rows[0].n,
          ),
          20000,
        );
      },
    );
    await t.test(
      "overpayments to a pledge and cross-donor allocations roll back",
      async () => {
        const before = await total("payments");
        await assert.rejects(payment(1, [{ pledge_id: p1, amount_minor: 1 }]));
        await assert.rejects(
          payment(
            100,
            [{ pledge_id: p3, amount_minor: 100 }],
            randomUUID(),
            "processed",
            null,
            otherDonor,
          ),
        );
        assert.equal(await total("payments"), before);
      },
    );
    await t.test(
      "retry keys are idempotent and reject changed allocations",
      async () => {
        const key = randomUUID(),
          id = await payment(100, [], key),
          before = await total("payments");
        assert.equal(await payment(100, [], key), id);
        assert.equal(await total("payments"), before);
        await assert.rejects(
          payment(100, [{ pledge_id: p3, amount_minor: 100 }], key),
        );
      },
    );
    await t.test(
      "pending and failed payments cannot fulfill pledges or receive receipts",
      async () => {
        const pending = await payment(100, [], randomUUID(), "pending");
        await assert.rejects(
          payment(
            100,
            [{ pledge_id: p3, amount_minor: 100 }],
            randomUUID(),
            "failed",
          ),
        );
        await assert.rejects(db.query("select issue_receipt($1)", [pending]));
        await assert.rejects(
          db.query("select allocate_payment($1,'[]')", [pending]),
        );
      },
    );
    let plan;
    await t.test(
      "installments preserve every cent and month-end dates",
      async () => {
        plan = (
          await db.query(
            "select create_schedule($1,$2,'installment','monthly','2027-01-31',10001,3) id",
            [org, p3],
          )
        ).rows[0].id;
        const installments = (
          await db.query(
            "select * from installments where schedule_id=$1 order by due_date",
            [plan],
          )
        ).rows;
        assert.deepEqual(
          installments.map((i) =>
            new Date(i.due_date).toISOString().slice(0, 10),
          ),
          ["2027-01-31", "2027-02-28", "2027-03-31"],
        );
        assert.equal(
          installments.reduce((s, i) => s + Number(i.amount_minor), 0),
          10001,
        );
        assert.deepEqual(
          installments.map((i) => Number(i.amount_minor)),
          [3334, 3334, 3333],
        );
        await assert.rejects(payment(1, [{ pledge_id: p3, amount_minor: 1 }]));
        await assert.rejects(
          db.query(
            "select create_schedule($1,$2,'installment','monthly','2027-01-31',1,1)",
            [org, p3],
          ),
        );
      },
    );
    await t.test(
      "paying installments releases the reservation and completes the plan exactly once",
      async () => {
        const installments = (
          await db.query(
            "select * from installments where schedule_id=$1 order by due_date",
            [plan],
          )
        ).rows;
        for (const i of installments)
          await payment(
            Number(i.amount_minor),
            [],
            randomUUID(),
            "processed",
            i.id,
          );
        assert.equal(
          (await db.query("select status from schedules where id=$1", [plan]))
            .rows[0].status,
          "completed",
        );
        assert.equal(
          Number(
            (
              await db.query(
                "select sum(amount_minor) n from payment_allocations where pledge_id=$1",
                [p3],
              )
            ).rows[0].n,
          ),
          10001,
        );
        await assert.rejects(
          payment(
            Number(installments[0].amount_minor),
            [],
            randomUUID(),
            "processed",
            installments[0].id,
          ),
        );
        await assert.rejects(
          db.query("select change_schedule($1,'active')", [plan]),
        );
      },
    );
    await t.test(
      "receipt issuance is idempotent and freezes payment details",
      async () => {
        const r1 = (
          await db.query("select issue_receipt($1) id", [firstPayment])
        ).rows[0].id;
        const r2 = (
          await db.query("select issue_receipt($1) id", [firstPayment])
        ).rows[0].id;
        assert.equal(r1, r2);
        assert.equal(
          Number(
            (await db.query("select snapshot from receipts where id=$1", [r1]))
              .rows[0].snapshot.amount_minor,
          ),
          25000,
        );
        await assert.rejects(
          db.query("update receipts set language='he' where id=$1", [r1]),
        );
        await assert.rejects(
          db.query("delete from payment_allocations where payment_id=$1", [
            firstPayment,
          ]),
        );
      },
    );
    await t.test("bad batch row rolls back every row", async () => {
      const before = await total("payments");
      const entries = [
        {
          donor_id: donor,
          amount_minor: 200,
          paid_on: "2026-10-19",
          method: "cash",
          status: "processed",
          idempotency_key: randomUUID(),
        },
        {
          donor_id: donor,
          amount_minor: -1,
          paid_on: "2026-10-19",
          method: "cash",
          status: "processed",
          idempotency_key: randomUUID(),
        },
      ];
      await assert.rejects(
        db.query("select record_payment_batch($1,$2::jsonb)", [
          org,
          JSON.stringify(entries),
        ]),
      );
      assert.equal(await total("payments"), before);
      entries[1].amount_minor = 300;
      assert.equal(
        (
          await db.query("select record_payment_batch($1,$2::jsonb) n", [
            org,
            JSON.stringify(entries),
          ])
        ).rows[0].n,
        2,
      );
      assert.equal(await total("payments"), before + 2);
    });
    await t.test(
      "contact edits preserve identity, audit history, and organization boundaries",
      async () => {
        await db.query("select update_donor($1,$2,$3::jsonb)", [
          org,
          donor,
          JSON.stringify({
            name: "Updated donor",
            hebrew_name: "שם עברי",
            id: randomUUID(),
            organization_id: randomUUID(),
          }),
        ]);
        assert.equal(
          (await db.query("select name from donors where id=$1", [donor]))
            .rows[0].name,
          "Updated donor",
        );
        assert.ok(
          (
            await db.query(
              "select * from activities where donor_id=$1 and type='updated'",
              [donor],
            )
          ).rows.length,
        );
        await db.query("select update_organization($1,$2::jsonb)", [
          org,
          JSON.stringify({
            name: "Updated charity",
            timezone: "America/Chicago",
          }),
        ]);
        assert.equal(
          (
            await db.query("select timezone from organizations where id=$1", [
              org,
            ])
          ).rows[0].timezone,
          "America/Chicago",
        );
        await assert.rejects(
          db.query("select update_donor($1,$2,$3::jsonb)", [
            org,
            donor,
            JSON.stringify({ emails: { invalid: true } }),
          ]),
        );
        await assert.rejects(
          db.query(
            "insert into attachments(organization_id,donor_id,file_name,mime_type,size_bytes,storage_path) values($1,$2,'a.txt','text/plain',10,'wrong/prefix')",
            [org, donor],
          ),
        );
        await db.query(
          "insert into storage.objects(bucket_id,name) values('donor-attachments',$1)",
          [`${org}/${donor}/test-file`],
        );
        assert.equal(
          (await db.query("select * from storage.objects")).rows.length,
          1,
        );
      },
    );
    await t.test(
      "other organizations and viewers cannot invoke financial writes",
      async () => {
        await actor(2);
        assert.equal((await db.query("select * from payments")).rows.length, 0);
        assert.equal(
          (await db.query("select * from storage.objects")).rows.length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into storage.objects(bucket_id,name) values('donor-attachments',$1)",
            [`${org}/${donor}/unauthorized`],
          ),
        );
        await assert.rejects(
          db.query("select issue_receipt($1)", [firstPayment]),
        );
        await assert.rejects(
          db.query("select allocate_payment($1,'[]')", [firstPayment]),
        );
        await assert.rejects(payment(100));
        await assert.rejects(
          db.query("select update_donor($1,$2,$3::jsonb)", [
            org,
            donor,
            JSON.stringify({ name: "Unauthorized" }),
          ]),
        );
        await db.exec("reset role");
        await db.query(
          "insert into memberships(organization_id,user_id,role) values($1,'00000000-0000-0000-0000-000000000003','viewer')",
          [org],
        );
        await actor(3);
        await assert.rejects(payment(100));
        await db.exec("reset role; set role anon");
        await assert.rejects(db.query("select * from receipts"));
        await assert.rejects(
          db.query("select allocate_payment($1,'[]')", [firstPayment]),
        );
      },
    );
  } finally {
    await db.close();
  }
});

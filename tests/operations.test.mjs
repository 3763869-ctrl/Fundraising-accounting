import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("verified invitations, last-owner protection, automations, and templates", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
   insert into auth.users values('00000000-0000-0000-0000-000000000001','owner@example.test',now()),('00000000-0000-0000-0000-000000000002','staff@example.test',now()),('00000000-0000-0000-0000-000000000003','other@example.test',now());`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    const actor = async (n) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
      ]);
      await db.exec("set role authenticated");
    };
    await actor(1);
    const org = (
      await db.query("select create_organization('Operations test') id")
    ).rows[0].id;
    let token;
    await t.test(
      "invitation tokens are hashed and bound to the invited verified email",
      async () => {
        token = (
          await db.query(
            "select invite_member($1,'staff@example.test','accountant') token",
            [org],
          )
        ).rows[0].token;
        assert.notEqual(
          (await db.query("select token_hash from invitations")).rows[0]
            .token_hash,
          token,
        );
        await assert.rejects(db.query("select accept_invitation($1)", [token]));
        await actor(2);
        assert.equal(
          (await db.query("select accept_invitation($1) org", [token])).rows[0]
            .org,
          org,
        );
        assert.equal(
          (
            await db.query(
              "select role from memberships where organization_id=$1 and user_id=auth.uid()",
              [org],
            )
          ).rows[0].role,
          "accountant",
        );
        await assert.rejects(db.query("select accept_invitation($1)", [token]));
      },
    );
    await t.test(
      "only owners change roles and the final owner cannot be removed",
      async () => {
        await assert.rejects(
          db.query("select change_member_role($1,auth.uid(),'owner')", [org]),
        );
        await actor(1);
        assert.equal(
          (await db.query("select * from organization_members($1)", [org])).rows
            .length,
          2,
        );
        await assert.rejects(
          db.query("select change_member_role($1,auth.uid(),'viewer')", [org]),
        );
        await db.query(
          "select change_member_role($1,'00000000-0000-0000-0000-000000000002','admin')",
          [org],
        );
        await actor(2);
        await assert.rejects(
          db.query("select invite_member($1,'other@example.test','admin')", [
            org,
          ]),
        );
        await actor(1);
      },
    );
    const donor = (
      await db.query(
        "insert into donors(organization_id,name) values($1,'Automation donor') returning id",
        [org],
      )
    ).rows[0].id;
    await t.test(
      "structured donor contacts and consent persist through authorized edits",
      async () => {
        const attributes = {
          first_name: "Shalom",
          last_name: "Review",
          english_name: "Shalom Review",
          alternate_names: ["שלום"],
          phone_contacts: [
            { label: "Cell", value: "+1 917 555 0101", consent: true },
          ],
          email_contacts: [
            { label: "Primary", value: "review@example.test", consent: false },
          ],
          active: false,
          addresses: [
            {
              type: "personal",
              number: "123",
              line1: "Sample Street",
              city: "Brooklyn",
              address: "123 Sample Street",
            },
          ],
        };
        await db.query("select update_donor($1,$2,$3::jsonb)", [
          org,
          donor,
          JSON.stringify(attributes),
        ]);
        let saved = (
          await db.query("select * from donors where id=$1", [donor])
        ).rows[0];
        for (const [key, value] of Object.entries(attributes))
          assert.deepEqual(saved[key], value);
        await actor(3);
        await assert.rejects(
          db.query("select update_donor($1,$2,$3::jsonb)", [
            org,
            donor,
            JSON.stringify({ phone_contacts: [] }),
          ]),
        );
        await actor(1);
        attributes.phone_contacts[0].consent = false;
        await db.query("select update_donor($1,$2,$3::jsonb)", [
          org,
          donor,
          JSON.stringify(attributes),
        ]);
        saved = (await db.query("select * from donors where id=$1", [donor]))
          .rows[0];
        assert.equal(saved.phone_contacts[0].consent, false);
      },
    );
    await t.test(
      "Sola attempts are durable, single-submit, server-finalized and block uncertain retries",
      async () => {
        const cardDonor = (
          await db.query(
            "insert into donors(organization_id,name) values($1,'Synthetic card donor') returning id",
            [org],
          )
        ).rows[0].id;
        const key = randomUUID();
        const prepare = async (k = key, amount = 123) =>
          (
            await db.query("select prepare_sola_payment($1,$2,$3,$4) result", [
              org,
              cardDonor,
              amount,
              k,
            ])
          ).rows[0].result;
        const first = await prepare();
        assert.equal(first.send, true);
        assert.equal((await prepare()).send, false);
        await assert.rejects(prepare(key, 124));
        await assert.rejects(
          db.query("select finish_sola_payment($1,'approved','FAKE')", [
            first.attempt,
          ]),
        );
        await assert.rejects(
          db.query(
            "select resolve_pending_payment($1,'processed',current_date)",
            [first.payment],
          ),
        );
        await db.exec("reset role;set role service_role");
        await db.query("select finish_sola_payment($1,'unknown',null)", [
          first.attempt,
        ]);
        await actor(1);
        await assert.rejects(prepare(randomUUID()));
        assert.equal(
          (
            await db.query("select status from payments where id=$1", [
              first.payment,
            ])
          ).rows[0].status,
          "pending",
        );
        const secondDonor = (
          await db.query(
            "insert into donors(organization_id,name) values($1,'Synthetic approved donor') returning id",
            [org],
          )
        ).rows[0].id;
        const second = (
          await db.query("select prepare_sola_payment($1,$2,123,$3) result", [
            org,
            secondDonor,
            randomUUID(),
          ])
        ).rows[0].result;
        await db.exec("reset role;set role service_role");
        await db.query(
          "select finish_sola_payment($1,'approved','SYNTHETIC123')",
          [second.attempt],
        );
        await db.query(
          "select finish_sola_payment($1,'approved','SYNTHETIC123')",
          [second.attempt],
        );
        await actor(1);
        assert.equal(
          (
            await db.query("select status from payments where id=$1", [
              second.payment,
            ])
          ).rows[0].status,
          "processed",
        );
        const posted = await db.query(
          "select count(*)::int n from journal_entries where event_key=$1",
          ["payment:" + second.payment],
        );
        assert.equal(posted.rows[0].n, 1);
        await actor(3);
        assert.equal(
          (await db.query("select * from sola_payment_attempts")).rows.length,
          0,
        );
        await assert.rejects(
          db.query("select prepare_sola_payment($1,$2,123,$3)", [
            org,
            secondDonor,
            randomUUID(),
          ]),
        );
        await actor(1);
      },
    );
    await t.test(
      "Sola merchant binding cannot be claimed by a browser or reassigned to another organization",
      async () => {
        await assert.rejects(
          db.query("select bind_sola_merchant($1,auth.uid())", [org]),
        );
        await db.exec("reset role;set role service_role");
        assert.equal(
          (
            await db.query("select bind_sola_merchant($1,$2) id", [
              org,
              "00000000-0000-0000-0000-000000000001",
            ])
          ).rows[0].id,
          org,
        );
        await actor(3);
        const otherOrg = (
          await db.query("select create_organization('Separate merchant') id")
        ).rows[0].id;
        await db.exec("reset role;set role service_role");
        await assert.rejects(
          db.query("select bind_sola_merchant($1,$2)", [
            otherOrg,
            "00000000-0000-0000-0000-000000000003",
          ]),
        );
        await actor(1);
      },
    );
    await t.test(
      "approved Sola money remains recorded as credit when a pledge changes during processing",
      async () => {
        const d = (
          await db.query(
            "insert into donors(organization_id,name) values($1,'Synthetic allocation race donor') returning id",
            [org],
          )
        ).rows[0].id;
        const c = (
          await db.query(
            "insert into campaigns(organization_id,name) values($1,'Synthetic allocation race campaign') returning id",
            [org],
          )
        ).rows[0].id;
        const p = (
          await db.query(
            "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values($1,$2,$3,100,current_date+30) returning id",
            [org, d, c],
          )
        ).rows[0].id;
        const allocations = JSON.stringify([
          { pledge_id: p, amount_minor: 100 },
        ]);
        const attempt = (
          await db.query(
            "select prepare_sola_payment($1,$2,123,$3,$4::jsonb) result",
            [org, d, randomUUID(), allocations],
          )
        ).rows[0].result;
        await db.query(
          "select record_payment($1,$2,100,current_date,'cash','processed','', $3,$4::jsonb)",
          [org, d, randomUUID(), allocations],
        );
        await db.exec("reset role;set role service_role");
        const result = (
          await db.query(
            "select finish_sola_payment($1,'approved','SYNTHETIC-RACE') result",
            [attempt.attempt],
          )
        ).rows[0].result;
        assert.equal(result.state, "approved");
        assert.equal(result.allocation_review, true);
        await actor(1);
        assert.equal(
          (
            await db.query("select status from payments where id=$1", [
              attempt.payment,
            ])
          ).rows[0].status,
          "processed",
        );
        assert.equal(
          (
            await db.query(
              "select * from payment_allocations where payment_id=$1",
              [attempt.payment],
            )
          ).rows.length,
          0,
        );
        const lines = (
          await db.query(
            "select sum(l.debit_minor)::int debit,sum(l.credit_minor)::int credit from journal_lines l join journal_entries e on e.id=l.entry_id where e.event_key=$1",
            ["payment:" + attempt.payment],
          )
        ).rows[0];
        assert.deepEqual(lines, { debit: 123, credit: 123 });
      },
    );
    await t.test(
      "failed payment rules create a task once and log execution",
      async () => {
        const rule = (
          await db.query(
            "insert into automation_rules(organization_id,name,event,action,min_amount_minor,subject) values($1,'Follow up','payment_failed','create_task',100,'Call donor') returning id",
            [org],
          )
        ).rows[0].id;
        const key = randomUUID();
        const args = [org, donor, key];
        await db.query(
          "select record_payment($1,$2,500,'2026-10-19','external_card','failed','Test',$3)",
          args,
        );
        assert.equal((await db.query("select * from tasks")).rows.length, 1);
        assert.equal(
          (await db.query("select status from job_logs")).rows[0].status,
          "completed",
        );
        await db.query(
          "select record_payment($1,$2,500,'2026-10-19','external_card','failed','Test',$3)",
          args,
        );
        assert.equal((await db.query("select * from tasks")).rows.length, 1);
        await db.query("select toggle_automation($1,false)", [rule]);
        await db.query(
          "select record_payment($1,$2,500,'2026-10-19','external_card','failed','Test',$3)",
          [org, donor, randomUUID()],
        );
        assert.equal((await db.query("select * from tasks")).rows.length, 1);
      },
    );
    await t.test(
      "receipt templates freeze in acknowledgment snapshots",
      async () => {
        await db.query(
          "insert into document_templates(organization_id,name,language,body) values($1,'Thank you','en','Thank you {{donor}}')",
          [org],
        );
        const payment = (
          await db.query(
            "select record_payment($1,$2,500,'2026-10-19','cash','processed','Test',$3) id",
            [org, donor, randomUUID()],
          )
        ).rows[0].id;
        const receipt = (
          await db.query("select issue_receipt($1) id", [payment])
        ).rows[0].id;
        assert.equal(
          (
            await db.query("select snapshot from receipts where id=$1", [
              receipt,
            ])
          ).rows[0].snapshot.template,
          "Thank you {{donor}}",
        );
        await db.query(
          "insert into document_templates(organization_id,name,language,body) values($1,'New version','en','New text')",
          [org],
        );
        await db.query("select issue_receipt($1)", [payment]);
        assert.equal(
          (
            await db.query("select snapshot from receipts where id=$1", [
              receipt,
            ])
          ).rows[0].snapshot.template,
          "Thank you {{donor}}",
        );
      },
    );
    await t.test("pending payment resolution posts exactly once", async () => {
      const payment = (
        await db.query(
          "select record_payment($1,$2,500,'2026-10-19','check','pending','Pending',$3) id",
          [org, donor, randomUUID()],
        )
      ).rows[0].id;
      await db.query(
        "select resolve_pending_payment($1,'processed','2026-10-20')",
        [payment],
      );
      assert.equal(
        (await db.query("select status from payments where id=$1", [payment]))
          .rows[0].status,
        "processed",
      );
      assert.equal(
        (
          await db.query("select * from journal_entries where event_key=$1", [
            `payment:${payment}`,
          ])
        ).rows.length,
        1,
      );
      await assert.rejects(
        db.query(
          "select resolve_pending_payment($1,'processed','2026-10-20')",
          [payment],
        ),
      );
    });
    await t.test(
      "custom field definitions validate types and sponsorship capacity is enforced",
      async () => {
        await db.query(
          "insert into custom_field_definitions(organization_id,name,field_key,field_type,required) values($1,'Member number','member_number','number',true)",
          [org],
        );
        await assert.rejects(
          db.query(
            "insert into donors(organization_id,name) values($1,'Missing required field')",
            [org],
          ),
        );
        await assert.rejects(
          db.query(
            "insert into donors(organization_id,name,custom_fields) values($1,'Wrong type','{\"member_number\":\"text\"}')",
            [org],
          ),
        );
        await db.query(
          "insert into donors(organization_id,name,custom_fields) values($1,'Typed field','{\"member_number\":42}')",
          [org],
        );
        const campaign = (
          await db.query(
            "insert into campaigns(organization_id,name) values($1,'Sponsor campaign') returning id",
            [org],
          )
        ).rows[0].id;
        const sponsor = (
          await db.query(
            "insert into sponsorships(organization_id,name,availability_limit,default_price_minor) values($1,'One opportunity',1,18000) returning id",
            [org],
          )
        ).rows[0].id;
        await db.query(
          "insert into pledges(organization_id,donor_id,campaign_id,sponsorship_id,amount_minor,due_date) values($1,$2,$3,$4,18000,'2026-12-01')",
          [org, donor, campaign, sponsor],
        );
        await assert.rejects(
          db.query(
            "insert into pledges(organization_id,donor_id,campaign_id,sponsorship_id,amount_minor,due_date) values($1,$2,$3,$4,18000,'2026-12-02')",
            [org, donor, campaign, sponsor],
          ),
        );
      },
    );
    await t.test(
      "external organizations cannot read setup, jobs, or invitation metadata",
      async () => {
        await actor(3);
        assert.equal(
          (await db.query("select * from invitations")).rows.length,
          0,
        );
        assert.equal((await db.query("select * from job_logs")).rows.length, 0);
        assert.equal(
          (await db.query("select * from organization_members($1)", [org])).rows
            .length,
          0,
        );
        await assert.rejects(
          db.query(
            "insert into devices(organization_id,name,serial) values($1,'Unauthorized','bad')",
            [org],
          ),
        );
        await assert.rejects(
          db.query("select invite_member($1,'staff@example.test','viewer')", [
            org,
          ]),
        );
      },
    );
  } finally {
    await db.close();
  }
});

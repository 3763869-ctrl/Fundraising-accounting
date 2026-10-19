import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("verified invitations, last-owner protection, automations, and templates", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
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

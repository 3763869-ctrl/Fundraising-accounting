import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real embedded PostgreSQL engine, with a minimal stand-in for Supabase Auth's
// users table and verified JWT subject. Live Supabase Auth is tested separately.
test("PostgreSQL migration, organization isolation, and role permissions", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users values
        ('00000000-0000-0000-0000-000000000001'),
        ('00000000-0000-0000-0000-000000000002'),
        ('00000000-0000-0000-0000-000000000003');
    `);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610190001_foundation.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610190002_fundraising.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610190003_contact_management.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610190004_attachments.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610190005_accounting.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610190006_banking.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const actor = async (number) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        `00000000-0000-0000-0000-${String(number).padStart(12, "0")}`,
      ]);
      await db.exec("set role authenticated");
    };
    await actor(1);
    const org1 = (
      await db.query("select public.create_organization('First charity') as id")
    ).rows[0].id;
    await t.test(
      "owner creation is atomic and defaults to US/USD",
      async () => {
        const { rows } = await db.query(
          "select o.country,o.currency,m.role from public.organizations o join public.memberships m on m.organization_id=o.id",
        );
        assert.deepEqual(rows, [
          { country: "US", currency: "USD", role: "owner" },
        ]);
        await assert.rejects(
          db.query("select public.create_organization('  ')"),
        );
        assert.equal(
          (await db.query("select count(*)::int as count from organizations"))
            .rows[0].count,
          1,
        );
      },
    );
    const donor1 = (
      await db.query(
        "insert into donors(organization_id,name) values ($1,'First donor') returning id",
        [org1],
      )
    ).rows[0].id;
    const campaign1 = (
      await db.query(
        "insert into campaigns(organization_id,name) values ($1,'Annual appeal') returning id",
        [org1],
      )
    ).rows[0].id;
    await t.test("owner can record a pledge in cents", async () => {
      await db.query(
        "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values ($1,$2,$3,12550,'2026-12-01')",
        [org1, donor1, campaign1],
      );
      assert.equal(
        Number(
          (await db.query("select amount_minor from pledges")).rows[0]
            .amount_minor,
        ),
        12550,
      );
      await assert.rejects(
        db.query(
          "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values ($1,$2,$3,0,'2026-12-01')",
          [org1, donor1, campaign1],
        ),
      );
    });
    await actor(2);
    const org2 = (
      await db.query(
        "select public.create_organization('Second charity') as id",
      )
    ).rows[0].id;
    const campaign2 = (
      await db.query(
        "insert into campaigns(organization_id,name) values ($1,'Other appeal') returning id",
        [org2],
      )
    ).rows[0].id;
    await t.test(
      "another owner cannot read or insert first-organization records",
      async () => {
        assert.equal((await db.query("select * from donors")).rows.length, 0);
        assert.equal((await db.query("select * from pledges")).rows.length, 0);
        assert.equal(
          (await db.query("select * from memberships")).rows.length,
          1,
        );
        await assert.rejects(
          db.query(
            "insert into donors(organization_id,name) values ($1,'Unauthorized')",
            [org1],
          ),
        );
        await assert.rejects(
          db.query(
            "insert into memberships(organization_id,user_id,role) values ($1,auth.uid(),'owner')",
            [org1],
          ),
        );
      },
    );
    await t.test(
      "cross-organization pledge references are rejected",
      async () => {
        await assert.rejects(
          db.query(
            "insert into pledges(organization_id,donor_id,campaign_id,amount_minor,due_date) values ($1,$2,$3,500,'2026-12-01')",
            [org2, donor1, campaign2],
          ),
        );
      },
    );
    await db.exec("reset role");
    await db.query(
      "insert into memberships(organization_id,user_id,role) values ($1,'00000000-0000-0000-0000-000000000003','viewer')",
      [org1],
    );
    await actor(3);
    await t.test(
      "viewer can read but cannot write or promote their role",
      async () => {
        assert.equal((await db.query("select * from donors")).rows.length, 1);
        await assert.rejects(
          db.query(
            "insert into donors(organization_id,name) values ($1,'Unauthorized')",
            [org1],
          ),
        );
        await assert.rejects(
          db.query(
            "update memberships set role='owner' where user_id=auth.uid()",
          ),
        );
      },
    );
    await db.exec("reset role");
    await db.query(
      "update memberships set role='accountant' where user_id='00000000-0000-0000-0000-000000000003'",
    );
    await actor(3);
    await t.test("accountant cannot create fundraising records", async () => {
      assert.equal((await db.query("select * from pledges")).rows.length, 1);
      await assert.rejects(
        db.query(
          "insert into campaigns(organization_id,name) values ($1,'Unauthorized')",
          [org1],
        ),
      );
    });
    await db.exec("reset role; set role anon");
    await t.test("anonymous access is denied", async () => {
      await assert.rejects(db.query("select * from donors"));
      await assert.rejects(
        db.query("select public.create_organization('Unauthorized')"),
      );
    });
  } finally {
    await db.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  plaidSandbox,
  readSandboxSync,
  cleanTransaction,
} from "../lib/plaid/client.ts";
import { sealPlaid, openPlaid, plaidContext } from "../lib/plaid/vault.ts";
const transaction = (id, extra = {}) => ({
  transaction_id: id,
  account_id: "checking1",
  date: "2026-10-21",
  name: "Sandbox merchant",
  amount: 12.34,
  iso_currency_code: "USD",
  pending: false,
  ...extra,
});
test("Plaid Sandbox transport keeps credentials server-side, rejects production access tokens, and retries a mutated pagination from the original cursor", async () => {
  let calls = 0;
  const cursors = [];
  const call = plaidSandbox(
    "synthetic-client",
    "synthetic-secret",
    async (url, options) => {
      assert.equal(url, "https://sandbox.plaid.com/transactions/sync");
      const b = JSON.parse(options.body);
      assert.equal(b.client_id, "synthetic-client");
      assert.equal(b.secret, "synthetic-secret");
      cursors.push(b.cursor);
      calls++;
      if (calls === 1)
        return new Response(
          JSON.stringify({
            added: [transaction("discard")],
            modified: [],
            removed: [],
            next_cursor: "intermediate",
            has_more: true,
          }),
        );
      if (calls === 2)
        return new Response(
          JSON.stringify({
            error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
          }),
          { status: 400 },
        );
      return new Response(
        JSON.stringify({
          added: [transaction("keep")],
          modified: [],
          removed: [{ transaction_id: "old" }],
          next_cursor: "final",
          has_more: false,
        }),
      );
    },
  );
  const result = await readSandboxSync(
    call,
    "access-sandbox-synthetic",
    "original",
  );
  assert.deepEqual(cursors, ["original", "intermediate", "original"]);
  assert.deepEqual(
    result.added.map((t) => t.transaction_id),
    ["keep"],
  );
  assert.equal(result.added[0].amount_minor, 1234);
  assert.equal(result.cursor, "final");
  await assert.rejects(
    readSandboxSync(call, "access-production-not-allowed", ""),
    /Plaid Sandbox/,
  );
  assert.equal(calls, 3);
  assert.throws(() =>
    cleanTransaction(transaction("t", { iso_currency_code: "GBP" })),
  );
  assert.throws(() => cleanTransaction(transaction("t", { amount: Infinity })));
  const key = "a".repeat(64),
    context = plaidContext("organization", "connection"),
    sealed = sealPlaid("access-sandbox-synthetic", key, context);
  assert.equal(openPlaid(sealed, key, context), "access-sandbox-synthetic");
  assert.throws(() =>
    openPlaid(sealed, key, plaidContext("other", "connection")),
  );
  assert.throws(() => sealPlaid("access-production-invalid", key, context));
});
test("Plaid Sandbox sync is atomic and idempotent, isolates secrets and organizations, replaces pending entries, and never writes live bank or journal tables", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role service_role;create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;insert into auth.users values('00000000-0000-0000-0000-000000000001','owner@example.test',now()),('00000000-0000-0000-0000-000000000002','other@example.test',now());select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`,
    );
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const f of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(f, dir), "utf8"));
    await db.exec("set role authenticated");
    const org = (
      await db.query("select create_organization('Sandbox test') id")
    ).rows[0].id;
    await assert.rejects(
      db.query("select reserve_plaid_sandbox($1)", [org]),
      /permission denied/,
    );
    await db.exec("reset role;set role service_role");
    const c = (await db.query("select reserve_plaid_sandbox($1) c", [org]))
      .rows[0].c;
    await assert.rejects(
      db.query("select reserve_plaid_sandbox($1)", [org]),
      /already running/,
    );
    await db.query(
      "insert into plaid_sandbox_secrets(connection_id,encrypted_token) values($1,'encrypted-test-only')",
      [c.id],
    );
    const commit = (
      version,
      added = [],
      modified = [],
      removed = [],
      cursor = "cursor",
    ) =>
      db.query("select commit_plaid_sandbox_sync($1,$2,$3,$4,$5,$6)", [
        c.id,
        version,
        JSON.stringify(added),
        JSON.stringify(modified),
        JSON.stringify(removed),
        cursor,
      ]);
    await commit(0, [
      cleanTransaction(transaction("pending", { pending: true })),
    ]);
    await assert.rejects(commit(0), /Sync changed/);
    await commit(1, [
      cleanTransaction(
        transaction("posted", {
          pending_transaction_id: "pending",
          amount: -10,
        }),
      ),
    ]);
    await commit(
      2,
      [],
      [cleanTransaction(transaction("posted", { amount: -11 }))],
    );
    assert.equal(
      (
        await db.query(
          "select count(*) n from plaid_sandbox_transactions where not removed",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select amount_minor from plaid_sandbox_transactions where transaction_id='posted'",
          )
        ).rows[0].amount_minor,
      ),
      -1100,
    );
    await commit(3, [], [], ["posted"]);
    assert.equal(
      (
        await db.query(
          "select count(*) n from plaid_sandbox_transactions where not removed",
        )
      ).rows[0].n,
      0,
    );
    await db.exec("reset role;set role authenticated");
    await assert.rejects(
      db.query("select * from plaid_sandbox_secrets"),
      /permission denied/,
    );
    await assert.rejects(commit(4), /permission denied/);
    assert.equal(
      (await db.query("select count(*) n from bank_transactions")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*) n from journal_entries")).rows[0].n,
      0,
    );
    await db.exec(
      "reset role;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);set role authenticated",
    );
    assert.equal(
      (await db.query("select * from plaid_sandbox_connections")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from plaid_sandbox_transactions")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});

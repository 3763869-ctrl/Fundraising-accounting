import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sandboxFieldsAllowed,
  discardSetupTokens,
} from "../lib/sola/ifields.ts";

test("sandbox field policy never enables production or missing/ambiguous configuration", () => {
  const settings = {
    deployment: "preview",
    nodeEnvironment: "production",
    enabled: "true",
    hasSandboxKey: true,
    organization: "00000000-0000-0000-0000-000000000001",
  };
  assert.equal(sandboxFieldsAllowed(settings), true);
  for (const override of [
    { deployment: "production" },
    { deployment: undefined },
    { enabled: undefined },
    { enabled: "false" },
    { hasSandboxKey: false },
    { organization: undefined },
    { organization: "not-an-id" },
  ])
    assert.equal(sandboxFieldsAllowed({ ...settings, ...override }), false);
  assert.equal(
    sandboxFieldsAllowed({
      ...settings,
      deployment: undefined,
      nodeEnvironment: "development",
    }),
    true,
  );
});

test("secure-field setup consumes only success and immediately erases both nonces", () => {
  const card = { value: "synthetic-card-nonce" },
    cvv = { value: "synthetic-cvv-nonce" };
  assert.equal(discardSetupTokens(card, cvv), true);
  assert.deepEqual([card.value, cvv.value], ["", ""]);
  card.value = "synthetic-partial-nonce";
  assert.equal(discardSetupTokens(card, cvv), false);
  assert.deepEqual([card.value, cvv.value], ["", ""]);
  assert.equal(discardSetupTokens(null, null), false);
});

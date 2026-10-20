import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sandboxFieldsAllowed,
  discardSetupTokens,
} from "../lib/sola/ifields.ts";
import {
  usdAmount,
  validSut,
  validExpiry,
  interpretSolaResponse,
  submitSolaSale,
} from "../lib/sola/transaction.ts";

test("Sola approvals require matching exact cents and a safe provider reference", () => {
  assert.equal(usdAmount(123), "1.23");
  assert.equal(usdAmount(1), "0.01");
  assert.throws(() => usdAmount(1.5));
  assert.equal(validSut("4111111111111111"), false);
  assert.equal(validSut("123"), false);
  assert.equal(validExpiry("1329"), false);
  assert.equal(validExpiry("0120"), false);
  assert.deepEqual(
    interpretSolaResponse(
      { xResult: "A", xAuthAmount: "1.23", xRefNum: "123456" },
      123,
    ),
    { state: "approved", reference: "123456" },
  );
  for (const body of [
    { xResult: "A", xAuthAmount: "1.22", xRefNum: "123456" },
    { xResult: "A", xRefNum: "123456" },
    { xResult: "V", xRefNum: "123456" },
    { xResult: "E", xError: "Duplicate transaction" },
    null,
  ])
    assert.equal(interpretSolaResponse(body, 123).state, "unknown");
  assert.equal(interpretSolaResponse({ xResult: "D" }, 123).state, "declined");
});

test("Sola transport uses one server request and never retries an ambiguous timeout", async () => {
  const input = {
    key: "synthetic-test-key",
    amountMinor: 123,
    cardToken: "masked;sut_synthetic_card",
    cvvToken: "xxx;sut_synthetic_cvv",
    expiry: "1250",
    invoice: "00000000-0000-0000-0000-000000000001",
  };
  let calls = 0;
  const approved = await submitSolaSale(input, async (url, options) => {
    calls++;
    assert.equal(url, "https://x1.cardknox.com/gatewayjson");
    const payload = JSON.parse(options.body);
    assert.equal(payload.xCommand, "cc:sale");
    assert.equal(payload.xAmount, "1.23");
    assert.equal(payload.xAllowDuplicate, undefined);
    assert.equal(payload.xInvoice, input.invoice);
    return new Response(
      JSON.stringify({ xResult: "A", xAuthAmount: "1.23", xRefNum: "123456" }),
    );
  });
  assert.equal(approved.state, "approved");
  assert.equal(calls, 1);
  calls = 0;
  const uncertain = await submitSolaSale(input, async () => {
    calls++;
    throw new Error("Simulated timeout");
  });
  assert.equal(uncertain.state, "unknown");
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    submitSolaSale({ ...input, cardToken: "4111111111111111" }, async () => {
      calls++;
      return new Response();
    }),
  );
  assert.equal(calls, 0);
});

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

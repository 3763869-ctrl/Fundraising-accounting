import test from "node:test";
import assert from "node:assert/strict";
import {
  sealToken,
  openToken,
  cardContext,
  cardFromResponse,
} from "../lib/sola/vault.ts";
import { submitSolaSale, submitSolaCardSave } from "../lib/sola/transaction.ts";
const token = "synthetic_provider_token_1234567890",
  key = "12".repeat(32),
  id = "00000000-0000-0000-0000-000000000001";
const response = {
  xResult: "A",
  xAuthAmount: "1.23",
  xRefNum: "testref",
  xToken: token,
  xMaskedCardNumber: "4xxxxxxxxxxx1111",
  xCardType: "Visa",
};
const input = {
  key: "synthetic-api-key",
  amountMinor: 123,
  cardToken: "masked;sut_synthetic_card",
  cvvToken: "xxx;sut_synthetic_cvv",
  expiry: "1250",
  invoice: id,
};
test("provider tokens are encrypted and bound to their organization, donor and card", () => {
  const context = cardContext("org", "donor", "card"),
    sealed = sealToken(token, key, context);
  assert.ok(!sealed.includes(token));
  assert.equal(openToken(sealed, key, context), token);
  assert.throws(() =>
    openToken(sealed, key, cardContext("org", "other", "card")),
  );
  assert.throws(() => openToken(sealed, "34".repeat(32), context));
  assert.throws(() => sealToken("4111111111111111", key, context));
  assert.deepEqual(cardFromResponse(response, "1250"), {
    token,
    last4: "1111",
    brand: "Visa",
    expiry: "1250",
  });
  assert.equal(
    cardFromResponse(
      { ...response, xMaskedCardNumber: "4111111111111111" },
      "1250",
    ),
    null,
  );
});
test("saving is opt in, saved-card charges use only the server token, and standalone save has no charge amount", async () => {
  let payloads = [];
  const transport = async (url, options) => {
    payloads.push(JSON.parse(options.body));
    return new Response(JSON.stringify(response));
  };
  assert.equal((await submitSolaSale(input, transport)).card, undefined);
  assert.equal(
    (await submitSolaSale({ ...input, saveCard: true }, transport)).card.token,
    token,
  );
  await submitSolaSale(
    {
      key: input.key,
      amountMinor: 123,
      savedToken: token,
      expiry: "1250",
      invoice: id,
    },
    transport,
  );
  assert.equal(payloads[2].xToken, token);
  assert.equal(payloads[2].xCardNum, undefined);
  assert.equal(payloads[2].xCVV, undefined);
  const saved = await submitSolaCardSave(input, transport);
  assert.equal(saved.state, "approved");
  assert.equal(payloads[3].xCommand, "cc:save");
  assert.equal(payloads[3].xAmount, undefined);
  assert.ok(payloads.every((p) => p.xAllowDuplicate === undefined));
  let calls = 0;
  const timeout = async () => {
    calls++;
    throw new Error("timeout");
  };
  assert.equal((await submitSolaCardSave(input, timeout)).state, "unknown");
  assert.equal(calls, 1);
});

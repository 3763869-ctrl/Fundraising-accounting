import test from "node:test";
import assert from "node:assert/strict";
import {
  matbiaDigits,
  formatMatbiaCard,
  formatMatbiaExpiry,
  validMatbiaCard,
  validMatbiaExpiry,
} from "../lib/matbia/card.ts";
test("Matbia entry formats pasted numbers and MM/YY while validating only documented number structure and current expiration", () => {
  assert.equal(formatMatbiaCard("8628-2400-0000-0000"), "8628 2400 0000 0000");
  assert.equal(matbiaDigits("8628 2400 0000 0000"), "8628240000000000");
  assert.equal(formatMatbiaExpiry("1250"), "12/50");
  assert.equal(matbiaDigits("12/50"), "1250");
  assert.equal(validMatbiaCard("8628240000000000"), true);
  assert.equal(validMatbiaCard("4111111111111111"), false);
  assert.equal(validMatbiaExpiry("1026", new Date("2026-10-22")), true);
  assert.equal(validMatbiaExpiry("0926", new Date("2026-10-22")), false);
  assert.equal(validMatbiaExpiry("1328"), false);
});

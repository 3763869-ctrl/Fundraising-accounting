import {
  MATBIA_SANDBOX_CARDS,
  validMatbiaCard,
  validMatbiaExpiry,
} from "./transaction.ts";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function parseMatbiaInput(value: unknown, org: string, limit: number) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        ![
          "organization",
          "donor",
          "amount_minor",
          "request_key",
          "allocations",
          "donation",
          "consent",
          "card_number",
          "expiry",
        ].includes(k),
    ) ||
    v.organization !== org ||
    !uuid.test(String(v.donor)) ||
    !uuid.test(String(v.request_key)) ||
    v.consent !== true ||
    !Number.isSafeInteger(v.amount_minor) ||
    Number(v.amount_minor) < 1 ||
    Number(v.amount_minor) > limit ||
    !validMatbiaCard(v.card_number) ||
    Object.values(MATBIA_SANDBOX_CARDS).includes(String(v.card_number)) ||
    !validMatbiaExpiry(v.expiry) ||
    !Array.isArray(v.allocations) ||
    v.allocations.length > 100
  )
    throw new Error("Invalid request");
  for (const a of v.allocations) {
    if (
      !a ||
      typeof a !== "object" ||
      Array.isArray(a) ||
      Object.keys(a).some((k) => !["pledge_id", "amount_minor"].includes(k)) ||
      !uuid.test(String(a.pledge_id)) ||
      !Number.isSafeInteger(a.amount_minor) ||
      a.amount_minor < 1
    )
      throw new Error("Invalid allocation");
  }
  const d = v.donation as Record<string, unknown>;
  if (
    !d ||
    typeof d !== "object" ||
    Array.isArray(d) ||
    Object.keys(d).some(
      (k) =>
        ![
          "campaign_id",
          "fundraiser_id",
          "sponsorship_id",
          "event_id",
          "description",
          "collector",
          "credit_confirmed",
        ].includes(k),
    ) ||
    !uuid.test(String(d.campaign_id)) ||
    ["fundraiser_id", "sponsorship_id", "event_id"].some(
      (k) => d[k] != null && !uuid.test(String(d[k])),
    ) ||
    typeof d.description !== "string" ||
    d.description.length > 10000 ||
    typeof d.collector !== "string" ||
    d.collector.length > 200 ||
    typeof d.credit_confirmed !== "boolean"
  )
    throw new Error("Invalid donation");
  return {
    donor: String(v.donor),
    amount_minor: Number(v.amount_minor),
    request_key: String(v.request_key),
    allocations: v.allocations,
    donation: d,
    card_number: v.card_number as string,
    expiry: v.expiry as string,
  };
}

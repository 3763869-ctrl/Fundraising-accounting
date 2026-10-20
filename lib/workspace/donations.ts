import { balance, scheduled, type Row, type WorkspaceData } from "./domain.ts";

export function suggestAllocations(
  data: WorkspaceData,
  donor: string,
  amount: number,
) {
  const pledges = data.tables.pledges
    .filter(
      (p) =>
        p.donor_id === donor &&
        !p.voided_at &&
        balance(data, p) - scheduled(data, p.id) > 0,
    )
    .sort(
      (a, b) =>
        String(a.pledged_on).localeCompare(String(b.pledged_on)) ||
        String(a.created_at).localeCompare(String(b.created_at)) ||
        a.id.localeCompare(b.id),
    );
  const available = (p: Row) => balance(data, p) - scheduled(data, p.id);
  const exact = pledges.find((p) => available(p) === amount);
  if (exact) return [{ pledge_id: exact.id, amount_minor: amount }];
  let remaining = amount;
  return pledges.flatMap((p) => {
    const n = Math.min(remaining, available(p));
    remaining -= n;
    return n > 0 ? [{ pledge_id: p.id, amount_minor: n }] : [];
  });
}

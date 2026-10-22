// Formatting and documented Matbia input checks only. An approved provider
// response, never a card prefix, determines whether a payment was successful.
export const matbiaDigits = (value: string) => value.replace(/\D/g, "");
export const formatMatbiaCard = (value: string) =>
  matbiaDigits(value)
    .slice(0, 16)
    .replace(/(\d{4})(?=\d)/g, "$1 ");
export const formatMatbiaExpiry = (value: string) => {
  const digits = matbiaDigits(value).slice(0, 4);
  return digits.length > 2
    ? `${digits.slice(0, 2)}/${digits.slice(2)}`
    : digits;
};
export function validMatbiaCard(card: unknown): card is string {
  return typeof card === "string" && /^862824\d{10}$/.test(card);
}
export function validMatbiaExpiry(
  exp: unknown,
  now = new Date(),
): exp is string {
  if (typeof exp !== "string" || !/^(0[1-9]|1[0-2])\d{2}$/.test(exp))
    return false;
  const year = 2000 + Number(exp.slice(2)),
    month = Number(exp.slice(0, 2));
  return (
    year > now.getUTCFullYear() ||
    (year === now.getUTCFullYear() && month >= now.getUTCMonth() + 1)
  );
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export type StoredCard = {
  token: string;
  last4: string;
  brand: string;
  expiry: string;
};
export function validVaultToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{16,512}$/.test(value) &&
    /[A-Za-z]/.test(value)
  );
}
export function cardFromResponse(
  value: unknown,
  expiry: string,
): StoredCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.xResult !== "A" || !validVaultToken(r.xToken)) return null;
  const masked = String(r.xMaskedCardNumber ?? "").replace(/\s|-/g, "");
  // Accept only the provider's masked response; never retain a PAN or SUT prefix.
  if (!/^(?:\d{1,6})?[xX*•#]{2,}\d{4}$/.test(masked)) return null;
  const brand = [
    "Visa",
    "MasterCard",
    "Mastercard",
    "Amex",
    "Discover",
    "Diners",
    "JCB",
  ].includes(String(r.xCardType))
    ? String(r.xCardType)
    : "Card";
  return { token: r.xToken, last4: masked.slice(-4), brand, expiry };
}
function vaultKey(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error("Card vault is not configured.");
  return Buffer.from(key, "hex");
}
export function sealToken(token: string, key: string, context: string) {
  if (!validVaultToken(token)) throw new Error("Invalid provider token.");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", vaultKey(key), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function openToken(encrypted: string, key: string, context: string) {
  const parts = encrypted.split(".");
  if (parts.length !== 3) throw new Error("Invalid card record.");
  const [iv, tag, data] = parts.map((s) => Buffer.from(s, "base64url"));
  if (iv.length !== 12 || tag.length !== 16)
    throw new Error("Invalid card record.");
  const decipher = createDecipheriv("aes-256-gcm", vaultKey(key), iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  const token = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]).toString("utf8");
  if (!validVaultToken(token)) throw new Error("Invalid card record.");
  return token;
}
export const cardContext = (org: string, donor: string, id: string) =>
  `sola:v1:${org}:${donor}:${id}`;

import "server-only";
import { cardContext, sealToken, type StoredCard } from "./vault";
export const vaultConfigured = () =>
  /^[a-f0-9]{64}$/i.test(process.env.SOLA_CARD_VAULT_KEY ?? "");
export function encryptedCard(
  card: StoredCard | undefined,
  org: string,
  donor: string,
  id: string,
) {
  if (!card || !vaultConfigured()) return null;
  return {
    last4: card.last4,
    brand: card.brand,
    expiry: card.expiry,
    encrypted_token: sealToken(
      card.token,
      process.env.SOLA_CARD_VAULT_KEY!,
      cardContext(org, donor, id),
    ),
  };
}

// Version referenced by Sola's official @cardknox/react-ifields 2.2.86 README.
// Pinned deliberately; this is not a claim that it is the latest SDK version.
export const IFIELDS_VERSION = "2.15.2309.2601";
export const IFIELDS_BASE = `https://cdn.cardknox.com/ifields/${IFIELDS_VERSION}`;

export function sandboxFieldsAllowed(settings: {
  deployment: string | undefined;
  nodeEnvironment: string | undefined;
  enabled: string | undefined;
  hasSandboxKey: boolean;
  organization: string | undefined;
}) {
  const isolated =
    settings.deployment === "preview" ||
    (settings.deployment === undefined &&
      settings.nodeEnvironment === "development");
  return (
    isolated &&
    settings.enabled === "true" &&
    settings.hasSandboxKey &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      settings.organization ?? "",
    )
  );
}

// Consume only a success flag; discard all nonce values immediately. The setup
// check must never save, log, display or submit card/CVV tokens.
export function discardSetupTokens(
  card: { value: string } | null,
  cvv: { value: string } | null,
) {
  const complete = Boolean(card?.value && cvv?.value);
  if (card) card.value = "";
  if (cvv) cvv.value = "";
  return complete;
}

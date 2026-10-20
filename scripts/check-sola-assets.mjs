import { IFIELDS_BASE } from "../lib/sola/ifields.ts";

// Optional deployment check of public, credential-free resources. No merchant
// API key is read, and the transaction endpoint is never called here.
if (process.env.SOLA_VERIFY_PUBLIC_ASSETS === "1") {
  for (const [name, url, mime] of [
    ["iFields SDK", `${IFIELDS_BASE}/ifields.min.js`, /javascript|ecmascript/i],
    ["iFields frame", `${IFIELDS_BASE}/ifield.htm`, /html/i],
    ["Sola gateway health", "https://x1.cardknox.com/status", null],
  ]) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (
      !response.ok ||
      (mime && !mime.test(response.headers.get("content-type") ?? ""))
    )
      throw new Error(
        `${name} availability check failed (${response.status}).`,
      );
    await response.body?.cancel();
    console.log(
      `${name}: HTTP ${response.status}. No credentials or transaction submitted.`,
    );
  }
}

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "";
export function cardBrand(value: unknown): CardBrand {
  const name =
    typeof value === "string" ? value.toLowerCase().replace(/[^a-z]/g, "") : "";
  if (name === "visa") return "visa";
  if (name === "mastercard" || name === "master") return "mastercard";
  if (name === "amex" || name === "americanexpress") return "amex";
  if (name === "discover") return "discover";
  return "";
}
const labels = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};
export function CardBrands({ active = "" }: { active?: CardBrand }) {
  return (
    <div className="card-brand-strip" aria-label="Card networks">
      {(Object.keys(labels) as Exclude<CardBrand, "">[]).map((brand) => (
        <span
          key={brand}
          className={`card-network ${active === brand ? "is-active" : ""} ${active && active !== brand ? "is-muted" : ""}`}
          data-brand={brand}
          aria-label={`${labels[brand]}${active === brand ? " detected" : ""}`}
        >
          <svg viewBox="0 0 64 40" role="img" aria-label={labels[brand]}>
            <rect
              x=".5"
              y=".5"
              width="63"
              height="39"
              rx="5"
              fill={brand === "amex" ? "#176ca5" : "white"}
              stroke={brand === "amex" ? "#176ca5" : "#e3e5eb"}
            />
            {brand === "visa" ? (
              <text
                x="32"
                y="27"
                textAnchor="middle"
                fill="#183580"
                fontFamily="Arial,sans-serif"
                fontSize="23"
                fontWeight="900"
                fontStyle="italic"
              >
                VISA
              </text>
            ) : brand === "mastercard" ? (
              <>
                <circle cx="25" cy="20" r="12" fill="#eb001b" />
                <circle
                  cx="39"
                  cy="20"
                  r="12"
                  fill="#f79e1b"
                  fillOpacity=".92"
                />
              </>
            ) : brand === "amex" ? (
              <text
                x="32"
                y="25"
                textAnchor="middle"
                fill="white"
                fontFamily="Arial,sans-serif"
                fontSize="16"
                fontWeight="900"
              >
                AMEX
              </text>
            ) : (
              <>
                <text
                  x="32"
                  y="23"
                  textAnchor="middle"
                  fill="#252536"
                  fontFamily="Arial,sans-serif"
                  fontSize="10"
                  fontWeight="800"
                >
                  DISCOVER
                </text>
                <path d="M28 32h28v-8c-8 6-18 8-28 8" fill="#ed8423" />
              </>
            )}
          </svg>
        </span>
      ))}
      <span className="card-network-status" aria-live="polite">
        {active ? labels[active] : "Card type detected automatically"}
      </span>
    </div>
  );
}

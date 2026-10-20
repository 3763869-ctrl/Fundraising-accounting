"use client";

import { useState } from "react";
import { ChevronDown, MessageSquare, Plus, Send, Trash2 } from "lucide-react";
import type { Command, WorkspaceData } from "@/lib/workspace/domain";

type Contact = { label: string; value: string; consent: boolean };
type Address = { type: string; address?: string; [key: string]: unknown };
type Props = {
  data: WorkspaceData;
  preset?: Record<string, unknown>;
  onSave: (command: Command) => Promise<void>;
  onClose: () => void;
};

export function DonorForm({ data, preset = {}, onSave, onClose }: Props) {
  const editing = Boolean(preset.id);
  const legacyName = String(preset.name ?? "")
    .trim()
    .split(/\s+/);
  const [section, setSection] = useState("details");
  const [english, setEnglish] = useState(Boolean(preset.english_name));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(preset.active !== false);
  const [names, setNames] = useState<string[]>(
    (preset.alternate_names as string[]) ?? [],
  );
  const [phones, setPhones] = useState<Contact[]>(() => {
    if (Array.isArray(preset.phone_contacts) && preset.phone_contacts.length)
      return preset.phone_contacts as Contact[];
    const legacy = (preset.phones as string[]) ?? [];
    return [
      "Home",
      "Cell",
      "Business",
      ...legacy.slice(3).map(() => "Other"),
    ].map((label, i) => ({ label, value: legacy[i] ?? "", consent: false }));
  });
  const [emails, setEmails] = useState<Contact[]>(() => {
    if (Array.isArray(preset.email_contacts) && preset.email_contacts.length)
      return preset.email_contacts as Contact[];
    const values = [
      ...new Set([
        String(preset.email ?? ""),
        ...((preset.emails as string[]) ?? []),
      ]),
    ].filter(Boolean);
    return (values.length ? values : [""]).map((value, i) => ({
      label: i ? "Other" : "Primary",
      value,
      consent: false,
    }));
  });
  const addresses = (preset.addresses as Address[]) ?? [];
  const input = (
    name: string,
    label: string,
    value: unknown = preset[name],
    type = "text",
    required = false,
  ) => (
    <label key={name}>
      {label
        .replace(/^(Primary|Business) address number$/, "Number")
        .replace(/^(Primary|Business) address line 1$/, "Address line 1")
        .replace(
          /^(Primary|Business) (city|country)$/,
          (_, _type, field: string) =>
            field.charAt(0).toUpperCase() + field.slice(1),
        )}
      {required && <span className="required"> *</span>}
      <input
        name={name}
        aria-label={label}
        type={type}
        dir="auto"
        defaultValue={String(value ?? "")}
        required={required}
        step={type === "number" ? "any" : undefined}
        autoFocus={name === "first_name"}
        maxLength={type === "email" ? 254 : 500}
      />
    </label>
  );
  const panel = (id: string, title: string, children: React.ReactNode) => (
    <section className="donor-panel" key={id}>
      <h3>
        <button
          type="button"
          aria-expanded={section === id}
          aria-controls={`donor-panel-${id}`}
          onClick={() => setSection(section === id ? "" : id)}
        >
          {title}
          <ChevronDown size={16} className={section === id ? "expanded" : ""} />
        </button>
      </h3>
      <div
        id={`donor-panel-${id}`}
        className="donor-panel-body"
        data-donor-section={id}
        hidden={section !== id}
      >
        {children}
      </div>
    </section>
  );
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const invalid = Array.from(form.elements).find((el) =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
        ? !el.validity.valid
        : false,
    ) as HTMLInputElement | undefined;
    if (invalid) {
      setSection(
        invalid.closest<HTMLElement>("[data-donor-section]")?.dataset
          .donorSection ?? "details",
      );
      requestAnimationFrame(() => invalid.reportValidity());
      return;
    }
    setBusy(true);
    setError("");
    const values = new FormData(form);
    const get = (key: string) => String(values.get(key) ?? "").trim();
    try {
      if (phones.some((p) => p.consent && !p.value.trim()))
        throw new Error(
          "Enter a phone number before recording text-message consent.",
        );
      if (emails.some((e) => e.consent && !e.value.trim()))
        throw new Error(
          "Enter an email address before recording email consent.",
        );
      const custom = {
        ...((preset.custom_fields as Record<string, unknown>) ?? {}),
      };
      for (const definition of data.tables.custom_field_definitions ?? []) {
        const key = String(definition.field_key),
          raw = get(`custom_${key}`);
        if (!raw) delete custom[key];
        else
          custom[key] =
            definition.field_type === "boolean"
              ? raw === "true"
              : definition.field_type === "number"
                ? Number(raw)
                : raw;
      }
      const contactPhones = phones.map((p) => ({
        ...p,
        value: p.value.trim(),
      }));
      const contactEmails = emails.map((e) => ({
        ...e,
        value: e.value.trim(),
      }));
      const primary = contactEmails[0]?.value ?? "";
      const attributes = {
        title: get("title"),
        first_name: get("first_name"),
        last_name: get("last_name"),
        name: [get("first_name"), get("last_name")].filter(Boolean).join(" "),
        english_name: get("english_name"),
        alternate_names: names.map((n) => n.trim()).filter(Boolean),
        hebrew_name: get("hebrew_name"),
        active,
        email: primary,
        emails: contactEmails.filter((e) => e.value).map((e) => e.value),
        email_contacts: contactEmails,
        phones: contactPhones
          .filter((p) => p.value)
          .map((p) => `${p.label}: ${p.value}`),
        phone_contacts: contactPhones,
        addresses: [
          ...addresses.filter(
            (a) => !["personal", "business"].includes(a.type),
          ),
          ...["personal", "business"]
            .map((type) => {
              const address: Address = { type };
              for (const key of [
                "number",
                "line1",
                "line2",
                "title",
                "city",
                "state",
                "postal_code",
                "country",
              ])
                address[key] = get(`${type}_${key}`);
              address.address = [
                [address.number, address.line1].filter(Boolean).join(" "),
                address.line2,
                [address.city, address.state, address.postal_code]
                  .filter(Boolean)
                  .join(", "),
                address.country,
              ]
                .filter(Boolean)
                .join("\n");
              return address;
            })
            .filter((a) => a.address || a.title),
        ],
        tags: get("tags")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        notes: get("notes"),
        occasions: get("occasions")
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
        custom_fields: custom,
        receipt_language: get("receipt_language") || "en",
        fundraiser_id: get("fundraiser_id") || null,
      };
      await onSave(
        editing
          ? { type: "donor_update", values: { donor: preset.id, attributes } }
          : { type: "insert", table: "donors", values: attributes },
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save donor.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="record-form donor-form" onSubmit={submit} noValidate>
      <div className="donor-status">
        <label className="check-label">
          <input
            type="checkbox"
            name="active"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active donor
        </label>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {panel(
        "details",
        "Donor Details",
        <>
          <div className="donor-name-grid">
            {input("title", "Title")}
            {input(
              "first_name",
              "First name",
              preset.first_name || legacyName[0],
              "text",
              true,
            )}
            {input(
              "last_name",
              "Last name",
              preset.last_name || legacyName.slice(1).join(" "),
              "text",
              true,
            )}
          </div>
          {english ? (
            input("english_name", "English / internal name")
          ) : (
            <button
              type="button"
              className="donor-add"
              onClick={() => setEnglish(true)}
            >
              <Plus size={14} />
              Add English / internal name
            </button>
          )}
          <h4>Phone Numbers</h4>
          {phones.map((phone, i) => (
            <div className="donor-contact-row" key={i}>
              <input
                className="contact-label"
                aria-label={`Phone ${i + 1} label`}
                value={phone.label}
                onChange={(e) =>
                  setPhones(
                    phones.map((p, n) =>
                      n === i ? { ...p, label: e.target.value } : p,
                    ),
                  )
                }
                maxLength={40}
              />
              <input
                type="tel"
                aria-label={`${phone.label} phone`}
                placeholder="+1"
                dir="ltr"
                value={phone.value}
                onChange={(e) =>
                  setPhones(
                    phones.map((p, n) =>
                      n === i ? { ...p, value: e.target.value } : p,
                    ),
                  )
                }
                maxLength={60}
              />
              <div className="contact-actions">
                {phone.label.toLowerCase() === "cell" && (
                  <label
                    className="contact-consent"
                    title="Donor agrees to text messages for donations and pledges"
                  >
                    <input
                      type="checkbox"
                      aria-label="Donor agrees to text messages for donations and pledges"
                      checked={phone.consent}
                      onChange={(e) =>
                        setPhones(
                          phones.map((p, n) =>
                            n === i ? { ...p, consent: e.target.checked } : p,
                          ),
                        )
                      }
                    />
                    <MessageSquare size={14} aria-hidden="true" />
                  </label>
                )}
                {i >= 3 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove phone ${i + 1}`}
                    onClick={() => setPhones(phones.filter((_, n) => n !== i))}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="donor-add"
            onClick={() =>
              setPhones([
                ...phones,
                { label: "Other", value: "", consent: false },
              ])
            }
          >
            <Plus size={14} />
            Add another phone
          </button>
          <h4>Emails</h4>
          {emails.map((email, i) => (
            <div className="donor-contact-row" key={i}>
              <input
                className="contact-label"
                aria-label={`Email ${i + 1} label`}
                value={email.label}
                onChange={(e) =>
                  setEmails(
                    emails.map((p, n) =>
                      n === i ? { ...p, label: e.target.value } : p,
                    ),
                  )
                }
                maxLength={40}
              />
              <input
                type="email"
                aria-label={i ? `Additional email ${i}` : "Primary email"}
                dir="ltr"
                value={email.value}
                onChange={(e) =>
                  setEmails(
                    emails.map((p, n) =>
                      n === i ? { ...p, value: e.target.value } : p,
                    ),
                  )
                }
                maxLength={254}
              />
              <div className="contact-actions">
                <label
                  className="contact-consent"
                  title="Donor agrees to donation and pledge emails"
                >
                  <input
                    type="checkbox"
                    aria-label={`Email ${i + 1} donation and pledge consent`}
                    checked={email.consent}
                    onChange={(e) =>
                      setEmails(
                        emails.map((p, n) =>
                          n === i ? { ...p, consent: e.target.checked } : p,
                        ),
                      )
                    }
                  />
                  <Send size={14} aria-hidden="true" />
                </label>
                {i > 0 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove email ${i + 1}`}
                    onClick={() => setEmails(emails.filter((_, n) => n !== i))}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="donor-add"
            onClick={() =>
              setEmails([
                ...emails,
                { label: "Other", value: "", consent: false },
              ])
            }
          >
            <Plus size={14} />
            Add another email
          </button>
          <h4>Names</h4>
          {names.map((name, i) => (
            <div className="donor-extra-name" key={i}>
              <input
                aria-label={`Additional name ${i + 1}`}
                dir="auto"
                value={name}
                onChange={(e) =>
                  setNames(
                    names.map((n, index) => (index === i ? e.target.value : n)),
                  )
                }
                maxLength={200}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove name ${i + 1}`}
                onClick={() =>
                  setNames(names.filter((_, index) => index !== i))
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="donor-add"
            onClick={() => setNames([...names, ""])}
          >
            <Plus size={14} />
            Add another name
          </button>
        </>,
      )}
      {panel(
        "addresses",
        "Address Details",
        <>
          {["personal", "business"].map((type) => {
            const a = addresses.find((a) => a.type === type) ?? { type };
            return (
              <div className="donor-address" key={type}>
                <h4>
                  {type === "personal" ? "Primary Address" : "Business Address"}
                </h4>
                <div className="donor-address-line">
                  {input(
                    `${type}_number`,
                    `${type === "personal" ? "Primary" : "Business"} address number`,
                    a.number,
                  )}
                  {input(
                    `${type}_line1`,
                    `${type === "personal" ? "Primary" : "Business"} address line 1`,
                    a.line1 ?? a.address,
                  )}
                </div>
                <div className="form-grid">
                  {input(`${type}_line2`, "Address line 2", a.line2)}
                  {input(`${type}_title`, "Address title", a.title)}
                </div>
                <div className="donor-city-grid">
                  {input(
                    `${type}_city`,
                    `${type === "personal" ? "Primary" : "Business"} city`,
                    a.city,
                  )}
                  {input(`${type}_state`, "State", a.state)}
                  {input(`${type}_postal_code`, "Zip code", a.postal_code)}
                </div>
                {input(
                  `${type}_country`,
                  `${type === "personal" ? "Primary" : "Business"} country`,
                  a.country,
                )}
              </div>
            );
          })}
        </>,
      )}
      {panel(
        "notes",
        "Notes, tags & attachments",
        <>
          <label>
            Notes
            <textarea
              name="notes"
              aria-label="Notes"
              rows={4}
              maxLength={10000}
              defaultValue={String(preset.notes ?? "")}
            />
          </label>
          {input(
            "tags",
            "Tags (comma separated)",
            ((preset.tags as string[]) ?? []).join(", "),
          )}
          <p className="muted">
            {editing
              ? "Manage attachments in this donor’s details after saving."
              : "Save this donor first, then open their details to add attachments."}
          </p>
        </>,
      )}
      {panel(
        "occasions",
        "Occasion",
        <label>
          Occasions (one per line)
          <textarea
            name="occasions"
            aria-label="Occasions (one per line)"
            rows={3}
            defaultValue={((preset.occasions as string[]) ?? []).join("\n")}
          />
        </label>,
      )}
      {panel(
        "custom",
        "Custom Fields",
        <>
          {(data.tables.custom_field_definitions ?? []).map((d) => {
            const key = String(d.field_key),
              value = ((preset.custom_fields as Record<string, unknown>) ?? {})[
                key
              ];
            return d.field_type === "boolean" ? (
              <label key={key}>
                {String(d.name)}
                <select
                  name={`custom_${key}`}
                  aria-label={String(d.name)}
                  required={Boolean(d.required)}
                  defaultValue={value === undefined ? "" : String(value)}
                >
                  <option value="">Select…</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
            ) : (
              input(
                `custom_${key}`,
                String(d.name),
                value,
                d.field_type === "number"
                  ? "number"
                  : d.field_type === "date"
                    ? "date"
                    : "text",
                Boolean(d.required),
              )
            );
          })}
          {!(data.tables.custom_field_definitions ?? []).length && (
            <p className="muted">
              No custom fields configured. Add donor fields in Settings → Custom
              Fields.
            </p>
          )}
        </>,
      )}
      {panel(
        "settings",
        "Settings",
        <>
          {input("hebrew_name", "Hebrew name")}
          <label>
            Receipt language
            <select
              name="receipt_language"
              aria-label="Receipt language"
              defaultValue={String(preset.receipt_language ?? "en")}
            >
              <option value="en">English</option>
              <option value="he">Hebrew</option>
            </select>
          </label>
          <label>
            Assigned fundraiser
            <select
              name="fundraiser_id"
              aria-label="Assigned fundraiser"
              defaultValue={String(preset.fundraiser_id ?? "")}
            >
              <option value="">Unassigned</option>
              {data.tables.fundraisers.map((r) => (
                <option key={r.id} value={r.id}>
                  {String(r.name)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Consent records permission only. Automatic email and text delivery
            requires a connected service.
          </p>
        </>,
      )}
      <footer className="form-footer">
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save Donor" : "Save New Donor"}
        </button>
      </footer>
    </form>
  );
}

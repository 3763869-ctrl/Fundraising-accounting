"use client";
import { useState } from "react";
import { Paperclip } from "lucide-react";
import { uploadAttachment, attachmentUrl } from "@/lib/workspace/store";
import type { WorkspaceData, Row } from "@/lib/workspace/domain";

export function Attachments({
  data,
  donor,
  demo,
  writable,
  onChange,
}: {
  data: WorkspaceData;
  donor: string;
  demo: boolean;
  writable: boolean;
  onChange: (d: WorkspaceData) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const download = async (row: Row) => {
    setError("");
    try {
      const url = await attachmentUrl(demo, row);
      const a = document.createElement("a");
      a.href = url;
      a.download = String(row.file_name);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
      if (demo) setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to download attachment.",
      );
    }
  };
  return (
    <section className="attachment-section">
      <h3>
        <Paperclip size={14} />
        Attachments
      </h3>
      <p className="muted">
        PDF, PNG, JPEG, or text · 5 MB maximum. Do not upload card or bank
        credentials.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {(data.tables.attachments ?? [])
        .filter((r) => r.donor_id === donor)
        .map((r) => (
          <div className="detail-list-row" key={r.id}>
            <button className="text-button" onClick={() => download(r)}>
              {String(r.file_name)}
            </button>
            <small>{Math.ceil(Number(r.size_bytes) / 1024)} KB</small>
          </div>
        ))}
      {writable && (
        <label className="attachment-upload">
          {busy ? "Uploading…" : "Add attachment"}
          <input
            type="file"
            aria-label="Add donor attachment"
            accept="application/pdf,image/png,image/jpeg,text/plain"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const target = e.target;
              setBusy(true);
              setError("");
              try {
                onChange(await uploadAttachment(demo, data, donor, file));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Upload failed.");
              } finally {
                target.value = "";
                setBusy(false);
              }
            }}
          />
        </label>
      )}
    </section>
  );
}

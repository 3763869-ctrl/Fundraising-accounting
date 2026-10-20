"use client";
import type { ReactNode } from "react";
export function RowMenu({ id, children }: { id: string; children: ReactNode }) {
  return (
    <details
      className="popover row-menu"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button"))
          e.currentTarget.removeAttribute("open");
      }}
      onToggle={(e) => {
        if (!e.currentTarget.open) return;
        document
          .querySelectorAll<HTMLDetailsElement>(".row-menu[open]")
          .forEach((menu) => {
            if (menu !== e.currentTarget) menu.open = false;
          });
        const body =
          e.currentTarget.querySelector<HTMLElement>(".popover-body");
        if (!body) return;
        const rect = e.currentTarget.getBoundingClientRect();
        body.style.position = "fixed";
        body.style.right = "auto";
        body.style.left = `${Math.max(8, Math.min(rect.right - 240, window.innerWidth - 248))}px`;
        body.style.top = `${Math.max(8, rect.bottom + body.offsetHeight > window.innerHeight ? rect.top - body.offsetHeight : rect.bottom)}px`;
      }}
    >
      <summary className="icon-button" aria-label={`Actions ${id}`}>
        ⋯
      </summary>
      <div className="popover-body">{children}</div>
    </details>
  );
}

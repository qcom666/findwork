"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SendActions } from "./LeadTools";

/** Сохранённый питч в списке «Мои лиды»: текст, копирование и отправка в один клик. После отправки этап становится «Написал». */
export function RowPitch({
  leadId, status, channel, subject, message, serviceLabel, source, phones, email,
}: { leadId: string; status: string; channel: string; subject: string; message: string; serviceLabel: string; source: string; phones: string[]; email: string | null }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  async function markSent() {
    if (status !== "new") return;
    try {
      await fetch("/api/leads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, status: "contacted" }),
      });
      router.refresh();
    } catch {}
  }

  return (
    <details className="group rounded-xl border border-line bg-surface-2 px-3 py-2 sm:col-span-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <b>Питч готов</b> <span className="text-muted">· {serviceLabel} · {source === "claude" ? "Claude" : "шаблон"}</span>
        </span>
        <span className="text-accent group-open:hidden">Показать</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message}</p>
        <div className="flex flex-wrap items-center gap-3">
          <SendActions leadId={leadId} channel={channel} pitch={{ subject, message }} phones={phones} email={email} onSent={markSent} />
          <button
            className="text-xs text-accent hover:underline"
            onClick={async () => {
              try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
            }}
          >
            {copied ? "Скопировано" : "Копировать текст"}
          </button>
          <a href={`/lead/${encodeURIComponent(leadId)}`} className="text-xs text-muted hover:text-ink">Править в карточке →</a>
        </div>
      </div>
    </details>
  );
}

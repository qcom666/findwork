"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Значение с кнопкой «копировать»: наименование, сумма, дата и почта переносятся в «Мой налог» без перепечатывания. */
export function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <button
        type="button"
        title="Скопировать"
        className="group flex max-w-full items-center gap-2 text-left"
        onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
        }}
      >
        <span className="min-w-0 break-words font-medium">{value}</span>
        <span className="shrink-0 text-xs text-accent group-hover:underline">{copied ? "скопировано" : "копировать"}</span>
      </button>
    </div>
  );
}

/** Поле для ссылки на чек. Пустое значение убирает чек, если вставили не ту ссылку. */
export function ReceiptForm({ paymentId, initial }: { paymentId: string; initial: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState(initial ?? "");
  const [edit, setEdit] = useState(!initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/admin/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить");
      setEdit(!url.trim());
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!edit && initial) {
    return (
      <p className="flex flex-wrap items-center gap-3 text-sm">
        <a href={initial} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Открыть чек</a>
        <button type="button" className="text-muted hover:text-ink hover:underline" onClick={() => setEdit(true)}>Изменить</button>
      </p>
    );
  }

  return (
    <form onSubmit={save} className="space-y-1">
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://lknpd.nalog.ru/api/v1/receipt/…"
          aria-label="Ссылка на чек"
          className="field"
          inputMode="url"
        />
        <button disabled={busy || (!url.trim() && !initial)} className="btn btn-primary btn-sm shrink-0">{busy ? "Сохраняю…" : "Сохранить"}</button>
      </div>
      {err && <p className="text-sm text-bad">{err}</p>}
    </form>
  );
}

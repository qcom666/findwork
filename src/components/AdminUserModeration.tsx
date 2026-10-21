"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Блокировка пользователя и «забрать все кредиты». Владельца (ADMIN_EMAILS) блокировать нельзя. */
export function AdminUserModeration({ userId, balance, banned, isAdmin }: { userId: number; balance: number; banned: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [zero, setZero] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(url: string, body: Record<string, unknown>, done: (data: { taken?: number }) => string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось");
      setMsg({ ok: true, text: done(data) });
      setOpen(false); setReason("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (isAdmin) return <p className="text-xs text-muted">Владелец: блокировка не применяется, кредиты не входят в учёт.</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-ghost btn-sm" disabled={busy || balance <= 0}
          onClick={() => confirm(`Забрать у пользователя все кредиты (${balance})? Это попадёт в его историю.`) && void call("/api/admin/users/credits", { userId, zero: true, note: "Кредиты забраны владельцем" }, (d) => `Забрано: ${d.taken ?? 0}`)}
        >
          Забрать все кредиты
        </button>
        {banned ? (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void call("/api/admin/users/ban", { userId, ban: false }, () => "Разблокирован")}>Разблокировать</button>
        ) : (
          <button className="btn btn-ghost btn-sm !text-bad" disabled={busy} onClick={() => setOpen((v) => !v)}>Заблокировать</button>
        )}
        {msg && <span className={`text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
      </div>

      {open && !banned && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void call("/api/admin/users/ban", { userId, ban: true, reason, zero }, (d) => `Заблокирован${d.taken ? `, забрано кредитов: ${d.taken}` : ""}`);
          }}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-3"
        >
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Причина (видна только вам)" aria-label="Причина блокировки" className="field w-64 py-1.5" />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> забрать все кредиты
          </label>
          <button disabled={busy} className="btn btn-primary btn-sm">{busy ? "…" : "Заблокировать"}</button>
          <button type="button" className="text-xs text-muted hover:text-ink hover:underline" onClick={() => setOpen(false)}>Отмена</button>
        </form>
      )}
    </div>
  );
}

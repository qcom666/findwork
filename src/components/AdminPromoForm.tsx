"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminPromoForm() {
  const router = useRouter();
  const [f, setF] = useState({ code: "", credits: "10", maxUses: "", days: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: f.code, credits: Number(f.credits), maxUses: f.maxUses ? Number(f.maxUses) : null, days: f.days ? Number(f.days) : null, note: f.note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось создать");
      setMsg({ ok: true, text: `Создан код ${data.code}` });
      setF({ ...f, code: "", note: "" });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="block lg:col-span-1"><span className="mb-1 block text-xs font-medium text-muted">Код (пусто: случайный)</span><input value={f.code} onChange={set("code")} className="field uppercase" maxLength={32} /></label>
      <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Кредитов</span><input type="number" min={1} max={1000} value={f.credits} onChange={set("credits")} className="field" required /></label>
      <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Использований (пусто: без лимита)</span><input type="number" min={1} value={f.maxUses} onChange={set("maxUses")} className="field" /></label>
      <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Срок, дней (пусто: бессрочно)</span><input type="number" min={1} value={f.days} onChange={set("days")} className="field" /></label>
      <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Заметка</span><input value={f.note} onChange={set("note")} className="field" maxLength={200} /></label>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-5">
        <button disabled={busy} className="btn btn-primary btn-sm">{busy ? "Создаю…" : "Создать промокод"}</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Ввод промокода. После успеха страница обновляется, и баланс в шапке меняется. */
export function PromoForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/promo/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось применить промокод");
      setMsg({ ok: true, text: `Начислено ${data.credits} кредитов. Баланс: ${data.balance}.` });
      setCode("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Промокод" aria-label="Промокод" className="field max-w-[14rem] uppercase" maxLength={40} />
        <button disabled={busy || !code.trim()} className="btn btn-ghost">{busy ? "Проверяю…" : "Применить"}</button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </form>
  );
}

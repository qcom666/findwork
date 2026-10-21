"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Быстрое начисление кредитов по e-mail. Кнопка «Себе» подставляет почту владельца. */
export function AdminGrant({ selfEmail }: { selfEmail: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("10");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/users/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, delta: Number(amount), note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось");
      setMsg({ ok: true, text: `Готово. Баланс ${email.trim().toLowerCase()}: ${data.balance}` });
      setNote("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Начислить кредиты</h2>
        <p className="text-xs text-muted">Себе или любому зарегистрированному пользователю. Чтобы списать, поставьте минус.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_0.6fr_1fr_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">E-mail получателя</span>
          <span className="flex gap-2">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field" placeholder="name@example.com" />
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setEmail(selfEmail)}>Себе</button>
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Кредитов</span>
          <input type="number" required value={amount} onChange={(e) => setAmount(e.target.value)} className="field" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Причина (попадёт в историю)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={100} className="field" placeholder="подарок, возврат…" />
        </label>
        <div className="flex items-end"><button disabled={busy || !email || !amount} className="btn btn-primary">{busy ? "…" : "Начислить"}</button></div>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </form>
  );
}

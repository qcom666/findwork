"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Ручное начисление или списание кредитов пользователю: минус в начале числа списывает. */
export function AdminUserCredits({ userId }: { userId: number }) {
  const router = useRouter();
  const [delta, setDelta] = useState("");
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
        body: JSON.stringify({ userId, delta: Number(delta), note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось");
      setMsg({ ok: true, text: `Баланс: ${data.balance}` });
      setDelta(""); setNote("");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+10 или −5" aria-label="Кредитов" className="field w-28 py-1.5" required />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Причина" aria-label="Причина" maxLength={100} className="field w-44 py-1.5" />
      <button disabled={busy || !delta} className="btn btn-ghost btn-sm">{busy ? "…" : "Применить"}</button>
      {msg && <span className={`text-xs ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
    </form>
  );
}

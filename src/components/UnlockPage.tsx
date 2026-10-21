"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Открывает сразу все ещё не открытые лиды на странице каталога. */
export function UnlockPage({ ids, balance }: { ids: string[]; balance: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const need = ids.length;
  const short = balance < need;

  async function run() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/leads/unlock-many", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось открыть");
      setNote(data.skipped ? `Пропущено заведений в чужом эксклюзиве: ${data.skipped}` : "");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <span>
        <b>{need}</b> на странице ещё не открыто. {short ? <span className="text-warn">Не хватает кредитов: нужно {need}, на балансе {balance}.</span> : <span className="text-muted">Баланс: {balance}.</span>}
        {err && <span className="ml-2 text-bad">{err}</span>}
        {note && <span className="ml-2 text-warn">{note}</span>}
      </span>
      {short ? (
        <Link href="/pricing" className="btn btn-primary btn-sm">Пополнить</Link>
      ) : (
        <button onClick={run} disabled={busy} className="btn btn-primary btn-sm">{busy ? "Открываю…" : `Открыть все за ${need}`}</button>
      )}
    </div>
  );
}

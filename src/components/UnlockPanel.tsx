"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function UnlockPanel({
  leadId, loggedIn, balance, cost, bonus,
}: { leadId: string; loggedIn: boolean; balance: number; cost: number; bonus: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [noCredits, setNoCredits] = useState(balance < cost && loggedIn);

  async function unlock() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/leads/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) { setNoCredits(true); setBusy(false); return; }
      if (!res.ok) throw new Error(data.error ?? "Не удалось открыть");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-accent bg-surface p-5">
      <h2 className="text-sm font-semibold">Открыть контакты</h2>
      <p className="mt-1 text-sm text-muted">
        За {cost} кредит: телефон, e-mail, соцсети, ссылка на сайт, проверка сайта и питч. Повторно открывать не придётся.
      </p>

      {!loggedIn ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/signup?next=${encodeURIComponent(`/lead/${leadId}`)}`} className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90">
            Зарегистрироваться{bonus > 0 ? ` и получить ${bonus} кредитов` : ""}
          </Link>
          <Link href={`/login?next=${encodeURIComponent(`/lead/${leadId}`)}`} className="rounded-lg border border-line px-4 py-2.5 text-sm hover:border-accent">
            Войти
          </Link>
        </div>
      ) : noCredits ? (
        <div className="mt-4">
          <p className="text-sm text-warn">На балансе {balance} кредитов, нужен {cost}.</p>
          <Link href="/pricing" className="mt-2 inline-block rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90">
            Пополнить баланс
          </Link>
        </div>
      ) : (
        <div className="mt-4">
          <button onClick={unlock} disabled={busy} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-60">
            {busy ? "Открываю…" : `Открыть за ${cost} кредит`}
          </button>
          <span className="ml-3 text-sm text-muted">Баланс: {balance}</span>
        </div>
      )}
      {err && <p className="mt-3 text-sm text-bad">{err}</p>}
    </section>
  );
}

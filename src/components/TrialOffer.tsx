"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Props = {
  /** eligible: можно оформить; login: не вошёл; no_telegram: аккаунт без Telegram */
  state: "eligible" | "login" | "no_telegram";
  planTitle: string; days: number; credits: number; trialRub: number; renewRub: string;
};

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-good" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

/**
 * Пробная неделя за 1 ₽ с автопродлением. Согласие на автопродление — отдельная отметка, по умолчанию не стоит, без неё кнопка
 * не работает; цена после пробной недели написана рядом с кнопкой (раздел 16 оферты).
 */
export function TrialOffer({ state, planTitle, days, credits, trialRub, renewRub }: Props) {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sending = useRef(false);

  async function start() {
    if (sending.current || !agree) return;
    sending.current = true;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/billing/trial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }) });
      if (res.status === 401) return router.push("/login?next=/pricing");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Не удалось начать оплату");
      window.location.href = data.url;
    } catch (e) {
      setErr((e as Error).message);
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="card relative !border-accent p-5 sm:p-6" aria-labelledby="trial-title">
      {/* Пятно в своём обрезающем слое: иначе оно расширяет карточку, и прокрутка к кнопке сдвигает содержимое вбок */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden="true">
        <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-accent opacity-10 blur-3xl" />
      </div>
      <div className="relative grid gap-6 md:grid-cols-[1fr_20rem] md:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><path d="M21.9 4.6 18.7 19.7c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9-8.2c.4-.4-.1-.6-.6-.2L6.3 13.3l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.5 3.1c.9-.3 1.6.2 1.4 1.5z" /></svg>
            Только для аккаунтов с Telegram
          </span>
          <h2 id="trial-title" className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Неделя тарифа «{planTitle}» за {trialRub} ₽</h2>
          <p className="mt-2 max-w-xl text-muted">Попробуйте подписку в деле: {days} дней всех возможностей тарифа и {credits} кредитов на контакты сразу.</p>
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <li className="flex gap-2"><Check /><span><b>{credits} кредитов</b> на балансе сразу после оплаты</span></li>
            <li className="flex gap-2"><Check /><span>Эксклюзивы, отчёты клиентам и скидка на пакеты</span></li>
            <li className="flex gap-2"><Check /><span>Напоминание в Telegram за сутки до списания</span></li>
            <li className="flex gap-2"><Check /><span>Кредиты не сгорают, даже если не продлите</span></li>
          </ul>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums">{trialRub} ₽</span>
            <span className="text-sm text-muted">за {days} дней</span>
          </p>
          <p className="mt-1 text-sm">затем <b>{renewRub}</b> в месяц, автопродление</p>

          {state === "eligible" ? (
            <>
              <label className="mt-4 flex cursor-pointer gap-2.5 text-xs leading-relaxed text-muted">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" />
                <span>
                  Соглашаюсь на автопродление: через {days} дней с моей карты спишется {renewRub} за месяц тарифа «{planTitle}», дальше каждый месяц,
                  пока я не отключу автопродление в аккаунте. Условия — в <Link href="/terms#trial" className="underline">разделе 16 оферты</Link>.
                </span>
              </label>
              <button onClick={start} disabled={!agree || busy} className="btn btn-primary mt-3 w-full">
                {busy ? "Переходим к оплате…" : `Попробовать за ${trialRub} ₽`}
              </button>
              {err && <p className="mt-2 text-sm text-bad">{err}</p>}
            </>
          ) : state === "login" ? (
            <Link href="/login?next=/pricing" className="btn btn-primary mt-4 w-full">Войти через Telegram</Link>
          ) : (
            <>
              <Link href="/account" className="btn btn-primary mt-4 w-full">Привязать Telegram</Link>
              <p className="mt-2 text-xs text-muted">В Telegram приходят напоминания о списаниях, поэтому пробная неделя только с ним.</p>
            </>
          )}
          <p className="mt-3 text-[11px] leading-snug text-muted">Оплата картой на странице ЮKassa, карта сохраняется у ЮKassa для автопродления. Один раз на аккаунт.</p>
        </div>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ExclusiveView = {
  mine: number | null;
  other: number | null;
  othersOpened: number;
  /** Тариф даёт эксклюзивы: сколько мест занято и сколько всего. null: подписки нет. */
  slots: { used: number; total: number } | null;
  planTitle: string | null;
  cost: number;
  days: number;
  balance: number;
};

const day = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

/**
 * Конкуренция за заведение и эксклюзив. Показываем, сколько других пользователей уже открыли контакты, и даём
 * подписчикам закрыть заведение для тех, кто его ещё не открывал. Те, кто открыл раньше, доступа не теряют.
 */
export function ExclusiveBox({ leadId, v }: { leadId: string; v: ExclusiveView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function call(release: boolean) {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/leads/exclusive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: leadId, release }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const full = v.slots ? v.slots.used >= v.slots.total : false;
  const noCredits = v.balance < v.cost;

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">Конкуренция и эксклюзив</h2>
      <p className="mt-1 text-sm text-muted">
        {v.othersOpened > 0
          ? <>Контакты этого заведения уже открыли ещё <b className="text-ink">{v.othersOpened}</b> {plural(v.othersOpened, "пользователь", "пользователя", "пользователей")}.</>
          : "Кроме вас, контакты этого заведения пока никто не открывал."}
      </p>

      {v.mine ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="rounded-lg bg-good-soft px-3 py-2 text-good">Эксклюзив у вас до {day(v.mine)}: новые пользователи не смогут открыть это заведение.</p>
          <button className="text-xs text-muted hover:text-bad hover:underline" disabled={busy} onClick={() => confirm("Отпустить эксклюзив? Кредиты не вернутся.") && call(true)}>
            Отпустить раньше срока
          </button>
        </div>
      ) : v.other ? (
        <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Другой пользователь взял эксклюзив до {day(v.other)}: новые пользователи это заведение открыть не смогут.</p>
      ) : !v.slots ? (
        <p className="mt-3 text-sm text-muted">
          Эксклюзив на {v.days} дней закроет заведение для тех, кто его ещё не открывал: {v.cost} кредита, доступно по подписке.{" "}
          <Link href="/pricing" className="text-accent hover:underline">Тарифы</Link>
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted">
            Эксклюзив на {v.days} дней закроет заведение для тех, кто его ещё не открывал. Кто открыл раньше, доступ сохраняет. Занято мест: {v.slots.used} из {v.slots.total}.
          </p>
          <button onClick={() => call(false)} disabled={busy || full || noCredits} className="btn btn-primary btn-sm">
            {busy ? "Беру…" : `Взять в эксклюзив · ${v.cost} кредита`}
          </button>
          {full && <p className="text-xs text-warn">Все места тарифа «{v.planTitle}» заняты: отпустите одно или дождитесь окончания срока.</p>}
          {!full && noCredits && <p className="text-xs text-warn">Не хватает кредитов. <Link href="/pricing" className="underline">Пополнить</Link></p>}
        </div>
      )}
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
    </section>
  );
}

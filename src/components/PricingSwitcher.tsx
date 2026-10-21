"use client";

import { useState } from "react";
import { plural } from "@/lib/format";
import { PERIODS, PLANS, fmtRub, planCredits, planPerLead, planPrice } from "@/lib/plans";
import { BuyButton } from "./BuyButton";

type Pkg = { id: string; title: string; credits: number; priceRub: number };
type Tab = "subscription" | "packages";

const perLead = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ₽`;
const credits = (n: number) => `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${plural(n, "кредит", "кредита", "кредитов")}`;
const monthsLabel = (m: number) => (m === 12 ? "12 месяцев" : `${m} ${plural(m, "месяц", "месяца", "месяцев")}`);

/**
 * Переключатель тарифов: подписка (тариф и срок) или разовые пакеты.
 * Тарифы и скидки берутся из plans.ts, пакеты передаёт страница. Покупка идёт через /api/billing/checkout.
 */
export function PricingSwitcher({ packages, enabled, initialTab = "subscription" }: { packages: Pkg[]; enabled: boolean; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [planId, setPlanId] = useState((PLANS.find((p) => p.popular) ?? PLANS[0]).id);
  const [months, setMonths] = useState(PERIODS[1]?.months ?? PERIODS[0].months);

  const plan = PLANS.find((p) => p.id === planId) ?? PLANS[0];
  const period = PERIODS.find((p) => p.months === months) ?? PERIODS[0];
  const total = planPrice(plan, months);
  const saved = plan.priceMonthRub * months - total;

  function onTabKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: Tab = tab === "subscription" ? "packages" : "subscription";
    setTab(next);
    document.getElementById(`pricing-tab-${next}`)?.focus();
  }

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Способ оплаты" onKeyDown={onTabKey} className="inline-flex rounded-xl border border-line bg-surface p-1">
        {(
          [
            ["subscription", "Подписка", "выгоднее"],
            ["packages", "Разовые пакеты", ""],
          ] as const
        ).map(([id, label, badge]) => (
          <button
            key={id}
            id={`pricing-tab-${id}`}
            role="tab"
            type="button"
            aria-selected={tab === id}
            aria-controls={`pricing-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              tab === id ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
            }`}
          >
            {label}
            {badge && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tab === id ? "bg-accent-ink/20" : "bg-good-soft text-good"}`}>{badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "subscription" ? (
        <div role="tabpanel" id="pricing-panel-subscription" aria-labelledby="pricing-tab-subscription" className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">На какой срок</legend>
            <div className="flex flex-wrap gap-2">
              {PERIODS.map((p) => (
                <label
                  key={p.months}
                  className="chip cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
                >
                  <input type="radio" name="period" className="sr-only" checked={months === p.months} onChange={() => setMonths(p.months)} />
                  {monthsLabel(p.months)}
                  {p.discountPct > 0 && <span className="count">−{p.discountPct}%</span>}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="sr-only">Тариф</legend>
            <div className="grid gap-4 md:grid-cols-3">
              {PLANS.map((p) => {
                const price = planPrice(p, months);
                const month = price / months;
                return (
                  <label
                    key={p.id}
                    className="card relative flex cursor-pointer flex-col p-5 transition-colors hover:border-accent has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
                  >
                    <input type="radio" name="plan" className="sr-only" checked={planId === p.id} onChange={() => setPlanId(p.id)} />
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{p.title}</p>
                      {p.popular && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink">популярный</span>}
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{p.tagline}</p>
                    <p className="mt-4 flex items-baseline gap-1.5">
                      <span className="text-3xl font-bold tabular-nums">{fmtRub(month)}</span>
                      <span className="text-sm text-muted">в месяц</span>
                    </p>
                    {period.discountPct > 0 && (
                      <p className="text-xs text-muted">
                        <s>{fmtRub(p.priceMonthRub)}</s> · скидка {period.discountPct}%
                      </p>
                    )}
                    <ul className="mt-4 space-y-1.5 text-sm">
                      <li><b>{credits(p.creditsPerMonth)}</b> каждый месяц</li>
                      <li className="text-muted">≈ {perLead(planPerLead(p, months))} за лид</li>
                      <li className="text-muted">Проверка сайта и питчи включены</li>
                    </ul>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="card flex flex-wrap items-center justify-between gap-4 p-5" aria-live="polite">
            <div>
              <p className="text-sm text-muted">Вы выбрали</p>
              <p className="text-lg font-semibold">
                «{plan.title}» на {monthsLabel(months)}: {fmtRub(total)}
              </p>
              <p className="text-sm text-muted">
                {credits(planCredits(plan, months))} за весь срок, приходят по {plan.creditsPerMonth} в месяц
                {saved > 0 && <> · экономия {fmtRub(saved)}</>}
              </p>
            </div>
            <div className="w-full sm:w-64">
              {enabled ? (
                <BuyButton planId={plan.id} months={months} primary label={`Купить подписку · ${fmtRub(total)}`} />
              ) : (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Приём оплаты скоро заработает.</p>
              )}
            </div>
          </div>
          <p className="text-sm text-muted">
            Платите один раз за весь срок. Автопродления нет, карта не привязывается. Кредиты за первый месяц приходят сразу, за следующие в ту же дату, и не сгорают.
          </p>
        </div>
      ) : (
        <div role="tabpanel" id="pricing-panel-packages" aria-labelledby="pricing-tab-packages" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {packages.map((p, i) => (
              <section key={p.id} className={`card flex flex-col p-5 ${i === 1 ? "!border-accent" : ""}`}>
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold">{p.title}</h3>
                  {i === 1 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">выгоднее</span>}
                </div>
                <p className="mt-3 text-3xl font-bold tabular-nums">{fmtRub(p.priceRub)}</p>
                <p className="mt-1 flex-1 text-sm text-muted">
                  {credits(p.credits)} · {perLead(p.priceRub / p.credits)} за лид
                </p>
                <div className="mt-5">{enabled ? <BuyButton packageId={p.id} primary={i === 1} /> : null}</div>
              </section>
            ))}
          </div>
          <p className="text-sm text-muted">Разовая покупка без обязательств. Кредиты не сгорают.</p>
          {!enabled && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Приём оплаты скоро заработает.</p>}
        </div>
      )}
    </div>
  );
}

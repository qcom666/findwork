"use client";

import { useState } from "react";
import { plural } from "@/lib/format";
import { EXCLUSIVE_COST, EXCLUSIVE_DAYS, PERIODS, PLANS, REPORT_COST, fmtRub, planCredits, planPerLead, planPrice } from "@/lib/plans";
import { BuyButton } from "./BuyButton";

type Pkg = { id: string; title: string; credits: number; priceRub: number };
type Tab = "subscription" | "packages";

const group = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const credits = (n: number) => `${group(n)} ${plural(n, "кредит", "кредита", "кредитов")}`;
const contacts = (n: number) => `${group(n)} ${plural(n, "контакт", "контакта", "контактов")}`;
const perLead = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ₽`;
const monthsLabel = (m: number) => (m === 12 ? "12 месяцев" : `${m} ${plural(m, "месяц", "месяца", "месяцев")}`);

/** Что входит в любой тариф: отличаются они объёмом и правами, а всё остальное одинаково. */
const INCLUDED = [
  "Телефон, e-mail, соцсети, ссылка на сайт",
  "WhatsApp и Telegram в один клик",
  "Проверка сайта и питч от Claude",
  "Заметки, статусы и экспорт в CSV",
  "Кредиты не сгорают",
];

function Check() {
  return (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-good" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

/**
 * Выбор тарифа: подписка (срок и тариф) или разовые пакеты.
 * Тарифы и скидки берутся из plans.ts, пакеты передаёт страница. Покупка идёт через /api/billing/checkout.
 * Карточка тарифа кликабельна (выбранная выделяется), у каждой своя кнопка «Подключить»: с клавиатуры работает кнопка.
 */
export function PricingSwitcher({ packages, enabled, initialTab = "subscription", packageDiscountPct = 0 }: { packages: Pkg[]; enabled: boolean; initialTab?: Tab; packageDiscountPct?: number }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [planId, setPlanId] = useState((PLANS.find((p) => p.popular) ?? PLANS[0]).id);
  const [months, setMonths] = useState(PERIODS[1]?.months ?? PERIODS[0].months);

  const period = PERIODS.find((p) => p.months === months) ?? PERIODS[0];

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
        <div role="tabpanel" id="pricing-panel-subscription" aria-labelledby="pricing-tab-subscription" className="space-y-6">
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

          <div className="grid items-stretch gap-5 pt-2 md:grid-cols-3">
            {PLANS.map((p) => {
              const total = planPrice(p, months);
              const month = total / months;
              const selected = planId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setPlanId(p.id)}
                  className={`card relative flex cursor-pointer flex-col p-5 transition-all ${
                    selected ? "!border-2 !border-accent shadow-lg" : "hover:border-accent"
                  }`}
                >
                  {p.popular && (
                    <span className="absolute -top-3 right-4 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-accent-ink">Популярный</span>
                  )}
                  <h3 className="text-lg font-bold">{p.title}</h3>
                  <p className="text-sm text-muted">{p.tagline}</p>

                  <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    {period.discountPct > 0 && <s className="text-sm text-muted">{fmtRub(p.priceMonthRub)}</s>}
                    <span className="text-3xl font-bold tabular-nums">{fmtRub(month)}</span>
                    <span className="text-sm text-muted">/мес</span>
                    {period.discountPct > 0 && (
                      <span className="rounded-md bg-good-soft px-1.5 py-0.5 text-xs font-semibold text-good">−{period.discountPct}%</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    ≈ {perLead(planPerLead(p, months))} за контакт{months > 1 && <> · всего {fmtRub(total)} за {monthsLabel(months)}</>}
                  </p>

                  <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                    <li className="flex gap-2"><Check /><span><b>{contacts(p.creditsPerMonth)}</b> в месяц{months > 1 && <span className="text-muted">, {group(planCredits(p, months))} за срок</span>}</span></li>
                    <li className="flex gap-2"><Check /><span><b>{p.perks.exclusiveSlots} эксклюзивов</b> сразу: другие не откроют ваш лид {EXCLUSIVE_DAYS} дней ({EXCLUSIVE_COST} кредита за каждый)</span></li>
                    <li className="flex gap-2"><Check /><span><b>{p.perks.reportsPer30d} отчётов клиенту</b> по ссылке за 30 дней, дальше {REPORT_COST} кредит</span></li>
                    <li className="flex gap-2"><Check /><span>Докупка кредитов <b>на {p.perks.packageDiscountPct}% дешевле</b></span></li>
                    {p.perks.referralMultiplier > 1 && <li className="flex gap-2"><Check /><span>Награда за приглашённых <b>×{p.perks.referralMultiplier}</b></span></li>}
                    <li className="flex gap-2"><Check /><span>До {group(p.perks.pitchesPerHour)} питчей в час</span></li>
                    {INCLUDED.map((t) => (
                      <li key={t} className="flex gap-2"><Check /><span>{t}</span></li>
                    ))}
                  </ul>

                  <div className="mt-6">
                    {enabled ? (
                      <BuyButton planId={p.id} months={months} primary={selected} label={`Подключить «${p.title}»`} />
                    ) : (
                      <p className="rounded-lg bg-warn-soft px-3 py-2 text-center text-sm text-warn">Приём оплаты скоро заработает</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-sm text-muted">
            Платите один раз за весь срок. Автопродления нет, карта не привязывается, пробных списаний нет. Кредиты за первый месяц приходят сразу, за следующие в ту же дату, и не сгорают.
          </p>
        </div>
      ) : (
        <div role="tabpanel" id="pricing-panel-packages" aria-labelledby="pricing-tab-packages" className="space-y-4">
          <div className="grid gap-5 pt-2 md:grid-cols-3">
            {packages.map((p, i) => (
              <section key={p.id} className={`card relative flex flex-col p-5 ${i === 1 ? "!border-2 !border-accent" : ""}`}>
                {i === 1 && <span className="absolute -top-3 right-4 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold text-accent-ink">Популярный</span>}
                <h3 className="text-lg font-bold">{p.title}</h3>
                {(() => {
                  const price = Math.round((p.priceRub * (100 - packageDiscountPct)) / 100);
                  return (
                    <>
                      <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
                        {packageDiscountPct > 0 && <s className="text-sm text-muted">{fmtRub(p.priceRub)}</s>}
                        <span className="text-3xl font-bold tabular-nums">{fmtRub(price)}</span>
                        {packageDiscountPct > 0 && <span className="rounded-md bg-good-soft px-1.5 py-0.5 text-xs font-semibold text-good">−{packageDiscountPct}% подписчикам</span>}
                      </p>
                      <p className="mt-1 flex-1 text-sm text-muted">
                        {credits(p.credits)} · ≈ {perLead(price / p.credits)} за контакт
                      </p>
                    </>
                  );
                })()}
                <div className="mt-6">{enabled ? <BuyButton packageId={p.id} primary={i === 1} label={`Купить «${p.title}»`} /> : null}</div>
              </section>
            ))}
          </div>
          <p className="text-sm text-muted">
            Разовая покупка без подписки и обязательств: кредиты не сгорают. По подписке контакт обходится дешевле, а докупать пакеты можно со скидкой {PLANS[0].perks.packageDiscountPct}–{PLANS[PLANS.length - 1].perks.packageDiscountPct}%.
          </p>
          {!enabled && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Приём оплаты скоро заработает.</p>}
        </div>
      )}
    </div>
  );
}

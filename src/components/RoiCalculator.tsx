"use client";

import { useState } from "react";
import { plural } from "@/lib/format";

const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;

/**
 * Калькулятор окупаемости. Все допущения вводит человек, мы ничего не обещаем: настоящую долю ответов и сделок
 * он узнает на своих первых лидах.
 */
export function RoiCalculator({ pricePerLead }: { pricePerLead: number }) {
  const [check, setCheck] = useState(30000);
  const [leads, setLeads] = useState(60);
  const [reply, setReply] = useState(15);
  const [close, setClose] = useState(20);

  const cost = leads * pricePerLead;
  const replies = (leads * reply) / 100;
  const deals = (replies * close) / 100;
  const revenue = deals * check;
  const profit = revenue - cost;
  const dealsToPay = Math.max(1, Math.ceil(cost / check));

  return (
    <div className="card grid gap-8 p-5 sm:p-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-5">
        <Slider label="Средний чек вашей услуги" value={check} min={5000} max={200000} step={1000} onChange={setCheck} format={rub} />
        <Slider label="Сколько лидов откроете" value={leads} min={10} max={300} step={10} onChange={setLeads} format={(n) => `${n} ${plural(n, "лид", "лида", "лидов")}`} />
        <Slider label="Доля заведений, которые ответят" value={reply} min={2} max={50} step={1} onChange={setReply} format={(n) => `${n}%`} />
        <Slider label="Доля ответивших, которые купят" value={close} min={2} max={50} step={1} onChange={setClose} format={(n) => `${n}%`} />
        <p className="text-xs text-muted">
          Доли ответов и сделок зависят от вашей услуги, цены и текста. Цифры выше только пример, подставьте свои. Реальные значения
          станут видны уже на первых 20 лидах.
        </p>
      </div>

      <div className="space-y-3 rounded-xl bg-surface-2 p-5">
        <Out label="Потратите на лиды" value={rub(cost)} sub={`${leads} кредитов по ${pricePerLead.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ₽`} />
        <Out label="Ответят" value={`≈ ${Math.round(replies)}`} />
        <Out label="Сделок" value={`≈ ${deals.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}`} />
        <Out label="Выручка" value={rub(revenue)} />
        <div className="border-t border-line pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Итог</p>
          <p className={`text-3xl font-bold tabular-nums ${profit >= 0 ? "text-good" : "text-bad"}`}>{profit >= 0 ? "+" : "−"}{rub(Math.abs(profit))}</p>
          <p className="mt-1 text-sm text-muted">
            Чтобы окупить лиды, хватит {dealsToPay} {plural(dealsToPay, "сделки", "сделок", "сделок")} при вашем чеке.
          </p>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; format: (n: number) => string }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <b className="tabular-nums">{format(value)}</b>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--accent)]"
      />
    </label>
  );
}

function Out({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted">{label}{sub && <span className="block text-xs">{sub}</span>}</span>
      <b className="text-lg tabular-nums">{value}</b>
    </div>
  );
}

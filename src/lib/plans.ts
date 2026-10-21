/**
 * Подписки: тарифы, сроки и скидки. Без обращений к базе, поэтому файл можно подключать и в клиентских компонентах.
 * Подписка не продлевается сама: платите один раз за выбранный срок, кредиты приходят раз в месяц.
 * Цены условные: меняйте здесь, оферта и страницы подтянут новые значения.
 */
export type Plan = { id: string; title: string; tagline: string; creditsPerMonth: number; priceMonthRub: number; popular?: boolean };
export type Period = { months: number; discountPct: number };

export const PLANS: Plan[] = [
  { id: "freelance", title: "Фриланс", tagline: "Один-два проекта в месяц", creditsPerMonth: 40, priceMonthRub: 790 },
  { id: "studio", title: "Студия", tagline: "Постоянный поток клиентов", creditsPerMonth: 120, priceMonthRub: 1990, popular: true },
  { id: "agency", title: "Агентство", tagline: "Команда и большой объём", creditsPerMonth: 400, priceMonthRub: 4990 },
];

export const PERIODS: Period[] = [
  { months: 1, discountPct: 0 },
  { months: 3, discountPct: 10 },
  { months: 12, discountPct: 20 },
];

export const getPlan = (id: string) => PLANS.find((p) => p.id === id);
export const getPeriod = (months: number) => PERIODS.find((p) => p.months === months);

/** Цена за весь срок в рублях, округлённая до целого рубля. */
export function planPrice(plan: Plan, months: number): number {
  const d = getPeriod(months)?.discountPct ?? 0;
  return Math.round((plan.priceMonthRub * months * (100 - d)) / 100);
}

export const planCredits = (plan: Plan, months: number) => plan.creditsPerMonth * months;

/** Цена за одно открытие контактов (1 кредит) в рублях. */
export const planPerLead = (plan: Plan, months: number) => planPrice(plan, months) / planCredits(plan, months);

/** Сумма с неразрывными пробелами между разрядами. Своя реализация, чтобы сервер и браузер печатали одинаково. */
export const fmtRub = (n: number) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;

/**
 * Прибавляет календарные месяцы к моменту времени (секунды Unix, UTC).
 * Если в нужном месяце нет такого числа, берётся последний день месяца: 31 января + 1 месяц = 28 (29) февраля.
 */
export function addMonths(ts: number, months: number): number {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.floor(
    Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000,
  );
}

/**
 * Подписки: тарифы, сроки и скидки. Без обращений к базе, поэтому файл можно подключать и в клиентских компонентах.
 * Подписка не продлевается сама: платите один раз за выбранный срок, кредиты приходят раз в месяц.
 * Цены условные: меняйте здесь, оферта и страницы подтянут новые значения.
 */
/**
 * Что подписка даёт сверх кредитов. Права действуют, пока подписка идёт, и считаются в entitlements.ts.
 * exclusiveSlots: сколько заведений можно держать в эксклюзиве одновременно;
 * reportsPer30d: сколько отчётов для клиента по ссылке входит в тариф за 30 дней (сверх: REPORT_COST);
 * packageDiscountPct: скидка на разовые пакеты кредитов; pitchesPerHour: лимит генерации питчей в час;
 * referralMultiplier: во сколько раз больше награда за приглашённого, который впервые заплатил.
 */
export type Perks = { exclusiveSlots: number; reportsPer30d: number; packageDiscountPct: number; pitchesPerHour: number; referralMultiplier: number };
export type Plan = { id: string; title: string; tagline: string; creditsPerMonth: number; priceMonthRub: number; perks: Perks; popular?: boolean };

/** Без подписки. Лимит питчей в час можно переопределить PITCH_HOURLY_LIMIT, см. entitlements.ts. */
export const BASE_PERKS: Perks = { exclusiveSlots: 0, reportsPer30d: 0, packageDiscountPct: 0, pitchesPerHour: 60, referralMultiplier: 1 };

/** Эксклюзив: сколько кредитов стоит и на сколько дней закрывает заведение для тех, кто его ещё не открывал. */
export const EXCLUSIVE_COST = 3;
export const EXCLUSIVE_DAYS = 30;
/** Отчёт для клиента: цена сверх тарифа или без подписки, срок жизни ссылки. */
export const REPORT_COST = 1;
export const REPORT_DAYS = 30;
export type Period = { months: number; discountPct: number };

export const PLANS: Plan[] = [
  {
    id: "freelance", title: "Фриланс", tagline: "Для старта и теста ниши", creditsPerMonth: 400, priceMonthRub: 990,
    perks: { exclusiveSlots: 5, reportsPer30d: 10, packageDiscountPct: 10, pitchesPerHour: 100, referralMultiplier: 1 },
  },
  {
    id: "studio", title: "Студия", tagline: "Для активных продаж", creditsPerMonth: 1500, priceMonthRub: 2490, popular: true,
    perks: { exclusiveSlots: 25, reportsPer30d: 60, packageDiscountPct: 20, pitchesPerHour: 200, referralMultiplier: 2 },
  },
  {
    id: "agency", title: "Агентство", tagline: "Для команд и потока", creditsPerMonth: 5000, priceMonthRub: 4990,
    perks: { exclusiveSlots: 100, reportsPer30d: 300, packageDiscountPct: 30, pitchesPerHour: 500, referralMultiplier: 2 },
  },
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

import { randomUUID } from "node:crypto";
import net from "node:net";
import { referralReward } from "./credits";
import { appDb, writeTx } from "./db";
import { getEntitlements, entitlementsAt } from "./entitlements";
import { plural } from "./format";
import { getPlan, planCredits, planPrice, type Plan } from "./plans";
import { activateTrial, startSubscription, type SavedMethod } from "./subscriptions";

export type Package = { id: string; title: string; credits: number; priceRub: number };

// Цены и размеры пакетов: меняйте здесь.
export const PACKAGES: Package[] = [
  { id: "s100", title: "Старт", credits: 100, priceRub: 490 },
  { id: "s400", title: "Стандарт", credits: 400, priceRub: 1490 },
  { id: "s1500", title: "Про", credits: 1500, priceRub: 3990 },
];

export const getPackage = (id: string) => PACKAGES.find((p) => p.id === id);

const now = () => Math.floor(Date.now() / 1000);

export function yookassaConfigured(): boolean {
  return !!(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
}

/** Тестовая оплата без ЮKassa: только локально, в продакшене её не бывает. */
export function mockMode(): boolean {
  return !yookassaConfigured() && process.env.NODE_ENV !== "production";
}

export function paymentsEnabled(): boolean {
  return yookassaConfigured() || mockMode();
}

export function appBaseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return new URL(req.url).origin;
}

// ---------------------------------------------------------------- клиент ЮKassa

export type YooPayment = {
  id: string;
  status: string;
  paid?: boolean;
  amount?: { value: string; currency: string };
  confirmation?: { confirmation_url?: string };
  metadata?: Record<string, string>;
  /** Способ оплаты; saved: true, если ЮKassa сохранила его для автоплатежей (только когда мы об этом просили) */
  payment_method?: { id?: string; type?: string; saved?: boolean; title?: string; card?: { last4?: string; card_type?: string } };
  cancellation_details?: { party?: string; reason?: string };
};

/** Подпись сохранённой карты для показа человеку: «Mir *4444» или «*4444». Номера карты у нас нет, только последние цифры от ЮKassa. */
export function methodTitle(m: YooPayment["payment_method"]): string {
  if (m?.card?.last4) return `${m.card.card_type && m.card.card_type !== "Unknown" ? `${m.card.card_type} ` : ""}*${m.card.last4}`;
  return m?.title || "";
}

export function savedMethod(yp: YooPayment): SavedMethod | null {
  const m = yp.payment_method;
  return m?.id ? { id: m.id, title: methodTitle(m), saved: m.saved === true } : null;
}

export async function yoo(path: string, init: { method?: string; idempotenceKey?: string; body?: unknown } = {}): Promise<YooPayment> {
  const base = process.env.YOOKASSA_API_URL ?? "https://api.yookassa.ru/v3";
  const auth = Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString("base64");
  const res = await fetch(base + path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      ...(init.idempotenceKey ? { "Idempotence-Key": init.idempotenceKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YooKassa ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as YooPayment;
}

function receipt(email: string, description: string, value: string) {
  // Нужен только ИП и ООО, у которых включены «Чеки от ЮKassa». Самозанятым чек формирует «Мой налог».
  if (process.env.YOOKASSA_RECEIPT !== "1") return {};
  return {
    receipt: {
      customer: { email },
      items: [
        {
          description: description.slice(0, 128),
          quantity: "1.00",
          amount: { value, currency: "RUB" },
          vat_code: parseInt(process.env.YOOKASSA_VAT_CODE ?? "1", 10), // 1 = без НДС
          payment_mode: process.env.YOOKASSA_PAYMENT_MODE ?? "full_payment",
          payment_subject: process.env.YOOKASSA_PAYMENT_SUBJECT ?? "service",
        },
      ],
      ...(process.env.YOOKASSA_TAX_SYSTEM ? { tax_system_code: parseInt(process.env.YOOKASSA_TAX_SYSTEM, 10) } : {}),
    },
  };
}

// ---------------------------------------------------------------- платежи

type Order = {
  packageId: string; kind: "credits" | "subscription" | "trial"; planId?: string; months?: number;
  credits: number; priceRub: number; description: string;
  /** Пробная неделя: попросить ЮKassa сохранить карту для автопродления; на странице оплаты тогда только карта */
  saveCard?: boolean;
  /** Выполняется после записи платежа, до перехода в ЮKassa: вебхук может прийти раньше, чем мы вернёмся из запроса */
  onCreated?: (paymentId: string) => Promise<void>;
};

async function createPayment(user: { id: number; email: string }, o: Order, baseUrl: string): Promise<{ paymentId: string; url: string }> {
  const db = await appDb();
  const id = randomUUID();
  const provider = yookassaConfigured() ? "yookassa" : "mock";
  await db.execute({
    sql: `INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at, kind, plan_id, months)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    args: [id, user.id, o.packageId, o.credits, o.priceRub * 100, provider, now(), o.kind, o.planId ?? null, o.months ?? null],
  });
  await o.onCreated?.(id);

  if (provider === "mock") return { paymentId: id, url: `/billing/mock?payment=${id}` };

  const value = o.priceRub.toFixed(2);
  try {
    const yp = await yoo("/payments", {
      method: "POST",
      idempotenceKey: id,
      body: {
        amount: { value, currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: `${baseUrl}/billing/return?payment=${id}` },
        description: o.description.slice(0, 128),
        metadata: { payment_id: id, user_id: String(user.id) },
        ...(o.saveCard ? { save_payment_method: true, payment_method_data: { type: "bank_card" } } : {}),
        ...receipt(user.email, o.description, value),
      },
    });
    const url = yp.confirmation?.confirmation_url;
    if (!url) throw new Error("YooKassa не вернула ссылку на оплату");
    await db.execute({ sql: "UPDATE payments SET provider_payment_id = ? WHERE id = ?", args: [yp.id, id] });
    return { paymentId: id, url };
  } catch (e) {
    await db.execute({ sql: "UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'pending'", args: [id] });
    throw e;
  }
}

/** Цена пакета для пользователя: подписчики докупают со скидкой по своему тарифу. */
export function packagePrice(pkg: Package, discountPct: number): number {
  return Math.round((pkg.priceRub * (100 - discountPct)) / 100);
}

export async function createCheckout(user: { id: number; email: string }, pkg: Package, baseUrl: string) {
  const { packageDiscountPct } = await getEntitlements(user.id);
  return createPayment(
    user,
    { packageId: pkg.id, kind: "credits", credits: pkg.credits, priceRub: packagePrice(pkg, packageDiscountPct), description: `Lidomap: ${pkg.credits} кредитов` },
    baseUrl,
  );
}

/** Подписка на months месяцев с оплатой один раз; автопродления нет (оно бывает только после пробной недели, autorenew.ts). */
/** Пробная неделя за TRIAL.priceRub с сохранением карты. Проверки, кому можно, и запись согласия: autorenew.ts. */
export function createTrialPayment(user: { id: number; email: string }, plan: Plan, o: { credits: number; priceRub: number; days: number }, baseUrl: string, onCreated: (paymentId: string) => Promise<void>) {
  return createPayment(
    user,
    {
      packageId: `trial:${plan.id}`, kind: "trial", planId: plan.id, credits: o.credits, priceRub: o.priceRub,
      description: `Lidomap: пробная неделя «${plan.title}», ${o.days} дней, далее автопродление`, saveCard: true, onCreated,
    },
    baseUrl,
  );
}

export function createSubscriptionCheckout(user: { id: number; email: string }, plan: Plan, months: number, baseUrl: string) {
  return createPayment(
    user,
    {
      packageId: `${plan.id}:${months}`, kind: "subscription", planId: plan.id, months,
      credits: planCredits(plan, months), priceRub: planPrice(plan, months),
      description: `Lidomap: подписка «${plan.title}», ${months} мес.`,
    },
    baseUrl,
  );
}

/**
 * Зачисляет кредиты за оплаченный платёж. Безопасно вызывать сколько угодно раз: начислит один.
 * method: сохранённая ЮKassa карта (для пробной недели: с неё пойдёт автопродление).
 */
export async function fulfillPayment(paymentId: string, method: SavedMethod | null = null): Promise<boolean> {
  return writeTx<boolean>(async (tx) => {
    const t = now();
    const upd = await tx.execute({
      sql: "UPDATE payments SET status = 'succeeded', paid_at = ? WHERE id = ? AND status = 'pending'",
      args: [t, paymentId],
    });
    if (upd.rowsAffected !== 1) return { value: false, rollback: true };
    const p = (await tx.execute({ sql: "SELECT user_id, credits, kind, plan_id, months, package_id FROM payments WHERE id = ?", args: [paymentId] })).rows[0];
    if (p.kind === "trial") {
      await activateTrial(tx, { userId: Number(p.user_id), paymentId, credits: Number(p.credits) }, t, method);
      return { value: true }; // за пробную неделю награду пригласившему не даём: иначе её фармили бы за 1 ₽
    }
    if (p.kind === "subscription") {
      await startSubscription(tx, { userId: Number(p.user_id), paymentId, planId: String(p.plan_id), months: Number(p.months), creditsTotal: Number(p.credits) }, t);
      // Очередной месяц автопродления: следующее списание — когда закончится только что оплаченный месяц
      const auto = /^autorenew:(\d+)$/.exec(String(p.package_id));
      if (auto) {
        const ends = Number((await tx.execute({ sql: "SELECT ends_at FROM subscriptions WHERE payment_id = ?", args: [paymentId] })).rows[0].ends_at);
        await tx.execute({
          sql: "UPDATE autorenewals SET next_charge_at = ?, charge_payment_id = NULL, failures = 0 WHERE id = ? AND charge_payment_id = ?",
          args: [ends, Number(auto[1]), paymentId],
        });
      }
    } else {
      await tx.execute({ sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [Number(p.credits), Number(p.user_id)] });
      await tx.execute({
        sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'purchase', ?, ?)",
        args: [Number(p.user_id), Number(p.credits), paymentId, t],
      });
    }

    // Реферальная награда: пригласивший получает кредиты один раз, за первую покупку приглашённого.
    const baseReward = referralReward();
    if (baseReward > 0) {
      const ref = (await tx.execute({ sql: "SELECT referred_by FROM users WHERE id = ?", args: [Number(p.user_id)] })).rows[0]?.referred_by;
      if (ref != null && Number(ref) !== Number(p.user_id)) {
        // Подписчики получают больше: множитель зависит от тарифа пригласившего на момент оплаты.
        const reward = baseReward * (await entitlementsAt(tx, Number(ref), t)).referralMultiplier;
        const done = await tx.execute({ sql: "SELECT 1 FROM referral_rewards WHERE referred_id = ?", args: [Number(p.user_id)] });
        if (!done.rows.length) {
          await tx.execute({ sql: "INSERT INTO referral_rewards(referred_id, referrer_id, credits, created_at) VALUES (?, ?, ?, ?)", args: [Number(p.user_id), Number(ref), reward, t] });
          await tx.execute({ sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [reward, Number(ref)] });
          await tx.execute({
            sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'referral', ?, ?)",
            args: [Number(ref), reward, String(p.user_id), t],
          });
        }
      }
    }
    return { value: true };
  });
}

export type SettleResult = "succeeded" | "canceled" | "pending" | "unknown" | "mismatch";

/**
 * Сверяет платёж с ЮKassa и при успехе зачисляет кредиты.
 * Содержимому вебхука не верим: статус и сумму берём из ответа API ЮKassa на запрос по id платежа.
 */
export async function settleByProviderId(providerPaymentId: string): Promise<SettleResult> {
  const db = await appDb();
  const row = (
    await db.execute({
      sql: "SELECT id, amount_kop FROM payments WHERE provider = 'yookassa' AND provider_payment_id = ?",
      args: [providerPaymentId],
    })
  ).rows[0];
  if (!row) return "unknown";

  const yp = await yoo(`/payments/${encodeURIComponent(providerPaymentId)}`);
  if (yp.status === "succeeded" && yp.paid === true) {
    const expected = (Number(row.amount_kop) / 100).toFixed(2);
    if (yp.amount?.currency !== "RUB" || yp.amount.value !== expected) {
      console.error(`[billing] сумма платежа ${providerPaymentId} не совпала: ${yp.amount?.value} ${yp.amount?.currency}, ждали ${expected} RUB`);
      return "mismatch";
    }
    await fulfillPayment(String(row.id), savedMethod(yp));
    return "succeeded";
  }
  if (yp.status === "canceled") {
    await db.execute({ sql: "UPDATE payments SET status = 'canceled' WHERE id = ? AND status = 'pending'", args: [String(row.id)] });
    return "canceled";
  }
  return "pending";
}

/**
 * Подстраховка на случай, когда вебхук не дошёл (не настроен или общий магазин ЮKassa смотрит на другой сайт):
 * сверяем с ЮKassa платежи пользователя, которые ждут подтверждения не дольше трёх суток. Безопасно вызывать часто:
 * без ожидающих платежей это один быстрый запрос, а повторные сверки ничего не начисляют дважды.
 */
export async function settlePendingForUser(userId: number): Promise<number> {
  if (!yookassaConfigured()) return 0;
  const db = await appDb();
  const rows = (
    await db.execute({
      sql: `SELECT provider_payment_id FROM payments
            WHERE user_id = ? AND status = 'pending' AND provider = 'yookassa' AND provider_payment_id IS NOT NULL AND created_at > ?
            ORDER BY created_at DESC LIMIT 5`,
      args: [userId, now() - 3 * 86400],
    })
  ).rows;
  let paid = 0;
  for (const r of rows) {
    const res = await settleByProviderId(String(r.provider_payment_id)).catch((e) => {
      console.error("[billing] сверка платежа не удалась", e);
      return "pending" as SettleResult;
    });
    if (res === "succeeded") paid++;
  }
  return paid;
}

export type PaymentRow = {
  id: string; packageId: string; credits: number; amountRub: number; status: string; provider: string;
  providerPaymentId: string | null; createdAt: number; kind: "credits" | "subscription" | "trial"; planId: string | null; months: number | null;
  /** Что куплено, для показа человеку. */
  title: string;
  /** Чек из «Мой налог», если владелец его уже оформил. */
  receiptUrl: string | null;
};

function toPayment(r: Record<string, unknown>): PaymentRow {
  const kind = r.kind === "subscription" || r.kind === "trial" ? r.kind : "credits";
  const planId = r.plan_id == null ? null : String(r.plan_id);
  const months = r.months == null ? null : Number(r.months);
  const planTitle = (planId && getPlan(planId)?.title) || planId;
  const title = kind === "trial"
    ? `Пробная неделя «${planTitle}»`
    : kind === "subscription"
      ? `Подписка «${planTitle}» на ${months} мес.${String(r.package_id).startsWith("autorenew:") ? " (автопродление)" : ""}`
      : `${Number(r.credits)} ${plural(Number(r.credits), "кредит", "кредита", "кредитов")}`;
  return {
    kind, planId, months, title,
    id: String(r.id), packageId: String(r.package_id), credits: Number(r.credits), amountRub: Number(r.amount_kop) / 100,
    status: String(r.status), provider: String(r.provider),
    providerPaymentId: r.provider_payment_id == null ? null : String(r.provider_payment_id), createdAt: Number(r.created_at),
    receiptUrl: r.receipt_url == null ? null : String(r.receipt_url),
  };
}

export async function getPayment(userId: number, id: string): Promise<PaymentRow | null> {
  const db = await appDb();
  const r = await db.execute({ sql: "SELECT * FROM payments WHERE id = ? AND user_id = ?", args: [id, userId] });
  return r.rows[0] ? toPayment(r.rows[0] as unknown as Record<string, unknown>) : null;
}

export async function listPayments(userId: number, limit = 20): Promise<PaymentRow[]> {
  const db = await appDb();
  const r = await db.execute({ sql: "SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", args: [userId, limit] });
  return r.rows.map((x) => toPayment(x as unknown as Record<string, unknown>));
}

/** Тестовая «карта»: с ней автопродление в тестовом режиме списывается сразу и без денег. */
export const MOCK_CARD: SavedMethod = { id: "mock-card", title: "Test *4444", saved: true };

/** Подтверждение тестовой оплаты (только когда mockMode()). */
export async function confirmMockPayment(userId: number, paymentId: string): Promise<boolean> {
  if (!mockMode()) return false;
  const p = await getPayment(userId, paymentId);
  if (!p || p.provider !== "mock") return false;
  return fulfillPayment(paymentId, p.kind === "trial" ? MOCK_CARD : null);
}

// ---------------------------------------------------------------- адреса ЮKassa (по документации)

const YOO_V4 = ["185.71.76.0/27", "185.71.77.0/27", "77.75.153.0/25", "77.75.156.11/32", "77.75.156.35/32", "77.75.154.128/25"];

function inCidr(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const toInt = (a: string) => a.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (toInt(ip) & mask) === (toInt(base) & mask);
}

export function yookassaIpAllowed(ip: string): boolean {
  if (net.isIPv4(ip)) return YOO_V4.some((c) => inCidr(ip, c));
  if (net.isIPv6(ip)) return ip.toLowerCase().startsWith("2a02:5180:");
  return false;
}

import { randomUUID } from "node:crypto";
import { baseUrl } from "./brand";
import { appDb, writeTx } from "./db";
import { createTrialPayment, fulfillPayment, MOCK_CARD, mockMode, paymentsEnabled, settleByProviderId, yoo, yookassaConfigured, type YooPayment } from "./billing";
import { LEGAL_VERSION } from "./legal";
import { TRIAL, fmtRub, getPlan, planPrice } from "./plans";
import { trialUsed } from "./subscriptions";
import { botConfigured, tgApi } from "./telegram-bot";

/**
 * Пробная неделя «Фриланса» за 1 ₽ и автопродление после неё (раздел 16 оферты, п. 42 ст. 16.1 Закона о защите прав потребителей).
 *
 *  - Пробную берут один раз, только с привязанным Telegram и без действующей подписки. Перед оплатой человек ставит отдельную
 *    отметку согласия на автопродление; её время и редакция оферты сохраняются.
 *  - ЮKassa сохраняет карту, у нас только её идентификатор. С неё через TRIAL.days дней и потом каждый месяц списывается цена месяца,
 *    зафиксированная при согласии.
 *  - За сутки до каждого списания бот присылает напоминание со ссылкой на отключение. Не удалось предупредить — не списываем
 *    (а если так и не удалось за NO_NOTICE_GIVEUP, автопродление выключается).
 *  - Отключить можно в «Аккаунте» в любой момент (и владелец в админке): после этого карта больше не используется.
 *  - Неудачное списание повторяется через сутки, после FAILURES_MAX неудач автопродление выключается.
 *
 * Списания и напоминания делает runAutorenewals: на сервере его раз в час запускает таймер lidomap-autorenew (scripts/autorenew.ts).
 */

const HOUR = 3600;
const DAY = 86400;
/** Напоминание уходит не раньше чем за NOTICE_AHEAD до списания, а списание — не раньше чем через NOTICE_MIN после напоминания. */
const NOTICE_AHEAD = 36 * HOUR;
const NOTICE_MIN = DAY;
const NO_NOTICE_GIVEUP = 3 * DAY;
const FAILURES_MAX = 3;
const now = () => Math.floor(Date.now() / 1000);

export type TrialBlock = "no_telegram" | "used" | "subscribed" | "disabled";

/**
 * Предлагать ли пробную неделю. ЮKassa сохраняет карты только магазинам, которым менеджер включил автоплатежи, поэтому
 * на проде её включает владелец (TRIAL_ENABLED=1 через scripts/server-secrets.sh), когда ЮKassa подтвердит. Выключение
 * останавливает только новые пробные недели: уже включённые автопродления работают дальше.
 */
export function trialEnabled(): boolean {
  return paymentsEnabled() && (mockMode() || process.env.TRIAL_ENABLED === "1");
}

/** Можно ли этому человеку взять пробную неделю; если нельзя, почему. */
export async function trialBlock(userId: number, t = now()): Promise<TrialBlock | null> {
  if (!trialEnabled()) return "disabled";
  const db = await appDb();
  const u = (await db.execute({ sql: "SELECT tg_id FROM users WHERE id = ?", args: [userId] })).rows[0];
  if (!u) return "disabled";
  if (u.tg_id == null) return "no_telegram";
  if (await trialUsed(db, userId, Number(u.tg_id))) return "used";
  const busy = await db.execute({
    sql: `SELECT 1 FROM subscriptions WHERE user_id = ? AND ends_at > ? AND payment_id NOT LIKE 'admin:%'
          UNION ALL SELECT 1 FROM autorenewals WHERE user_id = ? AND status = 'active' LIMIT 1`,
    args: [userId, t, userId],
  });
  return busy.rows.length ? "subscribed" : null;
}

export const TRIAL_BLOCK_TEXT: Record<TrialBlock, string> = {
  no_telegram: "Пробная неделя доступна аккаунтам с Telegram: привяжите его в «Аккаунте».",
  used: "Пробную неделю можно взять один раз.",
  subscribed: "У вас уже есть подписка.",
  disabled: "Пробная неделя сейчас недоступна.",
};

/** Цена месяца после пробной недели. */
export const trialPlan = () => getPlan(TRIAL.planId)!;
export const renewPriceRub = () => planPrice(trialPlan(), 1);

/** Оформить пробную неделю: проверить, записать согласие и создать платёж с сохранением карты. */
export async function startTrial(user: { id: number; email: string }, base: string): Promise<{ url: string } | { error: string }> {
  const block = await trialBlock(user.id);
  if (block) return { error: TRIAL_BLOCK_TEXT[block] };
  const plan = trialPlan();
  const priceKop = renewPriceRub() * 100;
  const { url } = await createTrialPayment(user, plan, TRIAL, base, async (paymentId) => {
    const db = await appDb();
    await db.execute({
      sql: `INSERT INTO autorenewals(user_id, plan_id, price_kop, trial_payment_id, status, consent_at, consent_ver, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
      args: [user.id, plan.id, priceKop, paymentId, now(), LEGAL_VERSION, now()],
    });
  });
  return { url };
}

export type Autorenewal = {
  id: number; userId: number; planId: string; title: string; priceRub: number; status: "pending" | "active" | "canceled";
  methodTitle: string | null; nextChargeAt: number | null; failures: number; canceledAt: number | null; cancelReason: string | null;
  createdAt: number; user?: string;
};

function toAuto(r: Record<string, unknown>): Autorenewal {
  return {
    id: Number(r.id), userId: Number(r.user_id), planId: String(r.plan_id), title: getPlan(String(r.plan_id))?.title ?? String(r.plan_id),
    priceRub: Number(r.price_kop) / 100, status: String(r.status) as Autorenewal["status"],
    methodTitle: r.method_title == null ? null : String(r.method_title), nextChargeAt: r.next_charge_at == null ? null : Number(r.next_charge_at),
    failures: Number(r.failures), canceledAt: r.canceled_at == null ? null : Number(r.canceled_at),
    cancelReason: r.cancel_reason == null ? null : String(r.cancel_reason), createdAt: Number(r.created_at),
  };
}

/** Последнее оформленное автопродление человека (в том числе отключённое): для «Аккаунта». */
export async function getAutorenewal(userId: number): Promise<Autorenewal | null> {
  const db = await appDb();
  const r = (await db.execute({ sql: "SELECT * FROM autorenewals WHERE user_id = ? AND status <> 'pending' ORDER BY id DESC LIMIT 1", args: [userId] })).rows[0];
  return r ? toAuto(r as unknown as Record<string, unknown>) : null;
}

/** Все включённые автопродления, ближайшие списания сверху: для админки. */
export async function listAutorenewals(limit = 300): Promise<Autorenewal[]> {
  const db = await appDb();
  const rs = await db.execute({
    sql: `SELECT a.*, u.email, u.tg_username, u.display_name FROM autorenewals a JOIN users u ON u.id = a.user_id
          WHERE a.status = 'active' ORDER BY a.next_charge_at, a.id LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => {
    const x = r as unknown as Record<string, unknown>;
    return { ...toAuto(x), user: x.tg_username ? `@${x.tg_username}` : String(x.display_name ?? x.email) };
  });
}

export type CancelBy = "user" | "admin" | "failed" | "no_notice" | "deleted";

/**
 * Отключить автопродление: карта больше не используется, оплаченный срок (и пробная неделя) доигрывает до конца.
 * Списание, которое уже ушло в ЮKassa, отменить нельзя: оно завершится, но следующего не будет.
 */
export async function cancelAutorenewal(userId: number, by: CancelBy, t = now()): Promise<boolean> {
  const db = await appDb();
  const r = await db.execute({
    sql: "UPDATE autorenewals SET status = 'canceled', canceled_at = ?, cancel_reason = ?, method_id = NULL WHERE user_id = ? AND status IN ('active', 'pending')",
    args: [t, by, userId],
  });
  return r.rowsAffected > 0;
}

// ---------------------------------------------------------------- напоминания и списания

/** Как отправить человеку сообщение в Telegram. Тесты подставляют свою функцию. */
export type Notify = (tgId: number, text: string) => Promise<void>;

const botNotify: Notify = async (tgId, text) => {
  if (!botConfigured()) throw new Error("бот не настроен");
  await tgApi("sendMessage", {
    chat_id: tgId, text, disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: "Подписка и автопродление", url: `${baseUrl()}/account#autorenew` }]] },
  });
};

const dayMonth = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
const time = (s: number) => new Date(s * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
const cancelHint = () => `Отключить автопродление можно в любой момент: ${baseUrl()}/account#autorenew`;

export const MESSAGES = {
  upcoming: (a: Autorenewal, at: number) =>
    `Lidomap: ${dayMonth(at)} около ${time(at)} (МСК) спишем ${fmtRub(a.priceRub)} ${a.methodTitle ? `с карты ${a.methodTitle}` : "с сохранённой карты"} за месяц подписки «${a.title}».\n\n${cancelHint()}`,
  charged: (a: Autorenewal, until: number) =>
    `Lidomap: списали ${fmtRub(a.priceRub)} за подписку «${a.title}», она продлена до ${dayMonth(until)}. Кредиты за месяц уже на балансе.\n\n${cancelHint()}`,
  retry: (a: Autorenewal, at: number) =>
    `Lidomap: не получилось списать ${fmtRub(a.priceRub)} за подписку «${a.title}». Попробуем ещё раз ${dayMonth(at)} около ${time(at)} (МСК).\n\n${cancelHint()}`,
  failed: (a: Autorenewal) =>
    `Lidomap: не получилось списать ${fmtRub(a.priceRub)} за подписку «${a.title}», автопродление отключено. Продлить подписку можно на странице тарифов: ${baseUrl()}/pricing`,
  noNotice: (a: Autorenewal) =>
    `Lidomap: автопродление подписки «${a.title}» отключено, потому что мы не смогли вовремя предупредить вас о списании. Деньги не списывались.`,
};

type Row = Autorenewal & { methodId: string | null; notifiedFor: number | null; notifiedAt: number | null; chargePaymentId: string | null; tgId: number | null };

async function dueRows(t: number): Promise<Row[]> {
  const db = await appDb();
  const rs = await db.execute({
    sql: `SELECT a.*, u.tg_id FROM autorenewals a JOIN users u ON u.id = a.user_id
          WHERE a.status = 'active' AND (a.charge_payment_id IS NOT NULL OR a.next_charge_at <= ?)`,
    args: [t + NOTICE_AHEAD],
  });
  return rs.rows.map((r) => {
    const x = r as unknown as Record<string, unknown>;
    return {
      ...toAuto(x), methodId: x.method_id == null ? null : String(x.method_id), notifiedFor: x.notified_for == null ? null : Number(x.notified_for),
      notifiedAt: x.notified_at == null ? null : Number(x.notified_at), chargePaymentId: x.charge_payment_id == null ? null : String(x.charge_payment_id),
      tgId: x.tg_id == null ? null : Number(x.tg_id),
    };
  });
}

/** Отправить сообщение и не уронить обход: ошибка Telegram только пишется в лог. */
async function send(notify: Notify, r: Row, text: string): Promise<boolean> {
  if (r.tgId == null) return false;
  try {
    await notify(r.tgId, text);
    return true;
  } catch (e) {
    console.error(`[autorenew] сообщение для ${r.userId} не ушло`, e);
    return false;
  }
}

/** Платёж за очередной месяц в ЮKassa с сохранённой карты. Повторный вызов с тем же платежом безопасен: тот же ключ идемпотентности. */
async function requestCharge(r: Row, paymentId: string): Promise<YooPayment["status"]> {
  const db = await appDb();
  const p = (await db.execute({ sql: "SELECT provider, amount_kop FROM payments WHERE id = ?", args: [paymentId] })).rows[0];
  if (p.provider === "mock") {
    // Тестовый режим: тестовая карта проходит, любая другая — нет (так в тестах проверяются неудачные списания).
    if (r.methodId === MOCK_CARD.id) return (await fulfillPayment(paymentId)) ? "succeeded" : "pending";
    await db.execute({ sql: "UPDATE payments SET status = 'canceled' WHERE id = ? AND status = 'pending'", args: [paymentId] });
    return "canceled";
  }
  const yp = await yoo("/payments", {
    method: "POST",
    idempotenceKey: paymentId,
    body: {
      amount: { value: (Number(p.amount_kop) / 100).toFixed(2), currency: "RUB" },
      capture: true,
      payment_method_id: r.methodId,
      description: `Lidomap: подписка «${r.title}», 1 мес., автопродление`,
      metadata: { payment_id: paymentId, user_id: String(r.userId) },
    },
  });
  await db.execute({ sql: "UPDATE payments SET provider_payment_id = ? WHERE id = ?", args: [yp.id, paymentId] });
  if (yp.status === "succeeded" || yp.status === "canceled") return (await settleByProviderId(yp.id)) === "succeeded" ? "succeeded" : yp.status;
  return yp.status;
}

/** Неудачное списание: повтор через сутки (о нём сообщаем, это и есть напоминание) или отключение после FAILURES_MAX неудач. */
async function failed(r: Row, t: number, notify: Notify): Promise<"retry" | "failed"> {
  const db = await appDb();
  const failures = r.failures + 1;
  if (failures >= FAILURES_MAX) {
    await db.execute({
      sql: "UPDATE autorenewals SET status = 'canceled', canceled_at = ?, cancel_reason = 'failed', method_id = NULL, charge_payment_id = NULL, failures = ? WHERE id = ?",
      args: [t, failures, r.id],
    });
    await send(notify, r, MESSAGES.failed(r));
    return "failed";
  }
  const next = t + DAY;
  await db.execute({ sql: "UPDATE autorenewals SET charge_payment_id = NULL, failures = ?, next_charge_at = ? WHERE id = ?", args: [failures, next, r.id] });
  if (await send(notify, r, MESSAGES.retry(r, next))) {
    await db.execute({ sql: "UPDATE autorenewals SET notified_for = ?, notified_at = ? WHERE id = ?", args: [next, t, r.id] });
  }
  return "retry";
}

async function afterCharge(r: Row, status: string, t: number, notify: Notify, out: RunResult): Promise<void> {
  if (status === "succeeded") {
    out.charged++;
    const db = await appDb();
    const until = Number((await db.execute({ sql: "SELECT next_charge_at FROM autorenewals WHERE id = ?", args: [r.id] })).rows[0].next_charge_at);
    await send(notify, r, MESSAGES.charged(r, until));
  } else if (status === "canceled") {
    if ((await failed(r, t, notify)) === "failed") out.disabled++;
    else out.retries++;
  }
  // pending: ЮKassa ещё проводит платёж, досмотрим в следующий раз
}

export type RunResult = { notified: number; charged: number; retries: number; disabled: number; errors: number };

/** Один обход: досмотреть начатые списания, разослать напоминания, списать то, что пора. Вызывать раз в час. */
export async function runAutorenewals(t = now(), notify: Notify = botNotify): Promise<RunResult> {
  const out: RunResult = { notified: 0, charged: 0, retries: 0, disabled: 0, errors: 0 };
  const db = await appDb();
  for (const r of await dueRows(t)) {
    try {
      // 1. Списание уже начато: узнать, чем кончилось
      if (r.chargePaymentId) {
        const p = (await db.execute({ sql: "SELECT status, provider_payment_id FROM payments WHERE id = ?", args: [r.chargePaymentId] })).rows[0];
        let status = String(p?.status ?? "failed");
        if (status === "pending") {
          status = p.provider_payment_id ? await settleByProviderId(String(p.provider_payment_id)) : await requestCharge(r, r.chargePaymentId);
        }
        if (status === "succeeded" || status === "canceled" || status === "failed") await afterCharge(r, status === "failed" ? "canceled" : status, t, notify, out);
        continue;
      }
      const at = r.nextChargeAt!;
      // 2. Напоминание за сутки (если ещё не отправлено для этого списания)
      if (r.notifiedFor !== at) {
        if (await send(notify, r, MESSAGES.upcoming(r, Math.max(at, t + NOTICE_MIN)))) {
          await db.execute({ sql: "UPDATE autorenewals SET notified_for = ?, notified_at = ? WHERE id = ?", args: [at, t, r.id] });
          out.notified++;
        } else if (t > at + NO_NOTICE_GIVEUP) {
          await cancelAutorenewal(r.userId, "no_notice", t);
          out.disabled++;
        }
        continue; // списываем не раньше следующего обхода и не раньше чем через сутки после напоминания
      }
      // 3. Списание: срок наступил и с напоминания прошли сутки
      if (t < at || t < (r.notifiedAt ?? t) + NOTICE_MIN) continue;
      if (!r.methodId) { await cancelAutorenewal(r.userId, "failed", t); out.disabled++; continue; }
      const paymentId = await beginCharge(r, t);
      if (!paymentId) continue; // другой обход уже начал это списание
      await afterCharge(r, await requestCharge(r, paymentId), t, notify, out);
    } catch (e) {
      out.errors++;
      console.error(`[autorenew] автопродление ${r.id} не обработано`, e);
    }
  }
  return out;
}

/** Записать платёж и пометить автопродление «списание идёт» одной транзакцией: второй обход не начнёт то же списание. */
async function beginCharge(r: Row, t: number): Promise<string | null> {
  const id = randomUUID();
  const provider = yookassaConfigured() ? "yookassa" : "mock";
  const plan = getPlan(r.planId)!;
  return writeTx<string | null>(async (tx) => {
    const upd = await tx.execute({ sql: "UPDATE autorenewals SET charge_payment_id = ? WHERE id = ? AND status = 'active' AND charge_payment_id IS NULL", args: [id, r.id] });
    if (upd.rowsAffected !== 1) return { value: null, rollback: true };
    await tx.execute({
      sql: `INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at, kind, plan_id, months)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 'subscription', ?, 1)`,
      args: [id, r.userId, `autorenew:${r.id}`, plan.creditsPerMonth, Math.round(r.priceRub * 100), provider, t, plan.id],
    });
    return { value: id };
  });
}

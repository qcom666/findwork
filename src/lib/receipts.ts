import { appDb } from "./db";
import { plural } from "./format";
import { isAdminEmail } from "./metrics";
import { getPlan } from "./plans";
import { isTgEmail } from "./telegram";

/**
 * Чеки самозанятого. ЮKassa чеки самозанятым не выдаёт (с 29.12.2025), поэтому владелец оформляет каждый в «Мой налог» сам,
 * а ссылку на чек вставляет в админке: покупатель видит её в «Аккаунте». Здесь очередь оплат без чека и готовые данные для чека.
 */

export type ReceiptItem = {
  paymentId: string;
  /** Наименование для «Мой налог». */
  title: string;
  amountRub: number;
  /** Когда пришли деньги: это дата продажи в чеке. */
  paidAt: number;
  /** Куда отправить чек: почта, @username в Telegram или пометка, если связаться нельзя. */
  contact: string;
  /** Почта настоящая (не служебная у аккаунта из Telegram и не стёртая при удалении). */
  hasEmail: boolean;
  ownAccount: boolean;
  receiptUrl: string | null;
  receiptAt: number | null;
};

export function receiptTitle(p: { kind: string; credits: number; planId: string | null; months: number | null }): string {
  if (p.kind === "subscription") {
    const plan = (p.planId && getPlan(p.planId)?.title) || p.planId || "";
    return `Подписка на сервис Lidomap «${plan}», ${p.months} ${plural(Number(p.months), "месяц", "месяца", "месяцев")}`;
  }
  return `Доступ к сервису Lidomap: пакет ${p.credits} ${plural(p.credits, "кредит", "кредита", "кредитов")}`;
}

function contactOf(email: string, tgUsername: string | null, deleted: boolean): { contact: string; hasEmail: boolean } {
  if (deleted) return { contact: "аккаунт удалён, чек оставьте у себя", hasEmail: false };
  if (isTgEmail(email)) return { contact: tgUsername ? `Telegram @${tgUsername}` : "Telegram без имени пользователя", hasEmail: false };
  return { contact: email, hasEmail: true };
}

/** Оплаты через ЮKassa: issued=false ждут чека (старые первыми, чтобы не пропустить срок), issued=true уже с чеком (новые первыми). */
export async function listReceipts(issued: boolean, limit = 100): Promise<ReceiptItem[]> {
  const db = await appDb();
  const r = await db.execute({
    sql: `SELECT p.id, p.kind, p.credits, p.plan_id, p.months, p.amount_kop, p.paid_at, p.created_at, p.receipt_url, p.receipt_at,
                 u.email, u.tg_username, u.deleted_at
          FROM payments p JOIN users u ON u.id = p.user_id
          WHERE p.status = 'succeeded' AND p.provider = 'yookassa' AND p.receipt_url IS ${issued ? "NOT NULL" : "NULL"}
          ORDER BY coalesce(p.paid_at, p.created_at) ${issued ? "DESC" : "ASC"} LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((x) => {
    const email = String(x.email);
    const c = contactOf(email, x.tg_username == null ? null : String(x.tg_username), x.deleted_at != null);
    return {
      paymentId: String(x.id),
      title: receiptTitle({ kind: String(x.kind), credits: Number(x.credits), planId: x.plan_id == null ? null : String(x.plan_id), months: x.months == null ? null : Number(x.months) }),
      amountRub: Number(x.amount_kop) / 100,
      paidAt: Number(x.paid_at ?? x.created_at),
      ...c,
      ownAccount: isAdminEmail(email),
      receiptUrl: x.receipt_url == null ? null : String(x.receipt_url),
      receiptAt: x.receipt_at == null ? null : Number(x.receipt_at),
    };
  });
}

/** Ссылка на чек из «Мой налог»: только https на домене налоговой, чтобы покупателю не показать опечатку или чужой адрес. */
export function parseReceiptUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 500) return null;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "nalog.ru" || host.endsWith(".nalog.ru") || host === "nalog.gov.ru" || host.endsWith(".nalog.gov.ru")) ? u.toString() : null;
  } catch {
    return null;
  }
}

export type SetReceiptResult = { ok: true } | { ok: false; error: string };

/** Сохраняет ссылку на чек (url пустой: убрать, если вставили не ту). Только для оплаченных платежей ЮKassa. */
export async function setReceipt(paymentId: string, url: string): Promise<SetReceiptResult> {
  const clean = url.trim() ? parseReceiptUrl(url) : null;
  if (url.trim() && !clean) return { ok: false, error: "Нужна ссылка на чек из «Мой налог»: https://lknpd.nalog.ru/…" };
  const db = await appDb();
  const r = await db.execute({
    sql: "UPDATE payments SET receipt_url = ?, receipt_at = ? WHERE id = ? AND status = 'succeeded' AND provider = 'yookassa'",
    args: [clean, clean ? Math.floor(Date.now() / 1000) : null, paymentId],
  });
  return r.rowsAffected === 1 ? { ok: true } : { ok: false, error: "Оплата не найдена" };
}

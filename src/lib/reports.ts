import { randomBytes } from "node:crypto";
import type { Finding } from "./audit";
import { appDb, writeTx } from "./db";
import { entitlementsAt } from "./entitlements";
import { REPORT_COST, REPORT_DAYS } from "./plans";

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

/**
 * Отчёт о проверке сайта заведения для его владельца: публичная страница по секретной ссылке с находками проверки и
 * контактами автора. Часть отчётов входит в подписку (за 30 дней), остальные стоят REPORT_COST. Ссылка живёт REPORT_DAYS дней.
 * В отчёте нет контактов самого заведения: только название, адрес сайта и результат проверки.
 */
export type ReportProfile = { name: string; contact: string; skills: string; portfolio: string; priceFrom: string };

const cut = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n) : "");

/** Чистит профиль из запроса. Портфолио остаётся только если это ссылка http(s). */
export function cleanProfile(p: Partial<Record<keyof ReportProfile, unknown>> | null | undefined): ReportProfile {
  const portfolio = cut(p?.portfolio, 200);
  return {
    name: cut(p?.name, 60),
    contact: cut(p?.contact, 120),
    skills: cut(p?.skills, 200),
    portfolio: /^https?:\/\/[^\s]+$/i.test(portfolio) ? portfolio : "",
    priceFrom: cut(p?.priceFrom, 40),
  };
}

export type ReportQuota = { included: number; used: number; left: number; cost: number; planTitle: string | null };

/** Сколько отчётов входит в тариф за 30 дней и сколько уже создано. Отозванные тоже считаются: услуга оказана. */
export async function reportQuota(userId: number): Promise<ReportQuota> {
  const db = await appDb();
  const t = now();
  const ent = await entitlementsAt(db, userId, t);
  const used = Number(
    (await db.execute({ sql: "SELECT count(*) AS n FROM audit_reports WHERE user_id = ? AND created_at > ? AND charged = 0", args: [userId, t - 30 * DAY] })).rows[0].n,
  );
  return { included: ent.reportsPer30d, used, left: Math.max(0, ent.reportsPer30d - used), cost: REPORT_COST, planTitle: ent.planTitle };
}

export type CreateReport =
  | { ok: true; token: string; charged: number; balance: number }
  | { ok: false; reason: "profile"; error: string }
  | { ok: false; reason: "insufficient"; balance: number };

export async function createReport(
  userId: number,
  input: { leadId: string; leadName: string; siteUrl: string; findings: Finding[]; profile: ReportProfile },
): Promise<CreateReport> {
  if (!input.profile.name || !input.profile.contact) {
    return { ok: false, reason: "profile", error: "Заполните имя и контакт в профиле: их увидит владелец заведения" };
  }
  const token = randomBytes(18).toString("base64url");
  return writeTx<CreateReport>(async (tx) => {
    const t = now();
    const ent = await entitlementsAt(tx, userId, t);
    const used = Number(
      (await tx.execute({ sql: "SELECT count(*) AS n FROM audit_reports WHERE user_id = ? AND created_at > ? AND charged = 0", args: [userId, t - 30 * DAY] })).rows[0].n,
    );
    const free = used < ent.reportsPer30d;
    const balance = Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] })).rows[0]?.balance ?? 0);
    if (!free && balance < REPORT_COST) return { value: { ok: false, reason: "insufficient", balance }, rollback: true };

    if (!free) {
      await tx.execute({ sql: "UPDATE users SET balance = balance - ? WHERE id = ?", args: [REPORT_COST, userId] });
      await tx.execute({
        sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'report', ?, ?)",
        args: [userId, -REPORT_COST, input.leadId, t],
      });
    }
    await tx.execute({
      sql: `INSERT INTO audit_reports(token, user_id, lead_id, lead_name, site_url, findings, profile, charged, created_at, expires_at, consent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        token, userId, input.leadId, input.leadName.slice(0, 200), input.siteUrl.slice(0, 300),
        JSON.stringify(input.findings.slice(0, 20).map((f) => ({ level: f.level, text: cut(f.text, 300) }))),
        JSON.stringify(input.profile), free ? 0 : REPORT_COST, t, t + REPORT_DAYS * DAY, t,
      ],
    });
    // Давно истёкшие отчёты не храним: через 60 дней после окончания ссылки строка удаляется.
    await tx.execute({ sql: "DELETE FROM audit_reports WHERE expires_at < ?", args: [t - 60 * DAY] });
    return { value: { ok: true, token, charged: free ? 0 : REPORT_COST, balance: free ? balance : balance - REPORT_COST } };
  });
}

export type PublicReport =
  | { state: "ok"; leadName: string; siteUrl: string; findings: Finding[]; profile: ReportProfile; createdAt: number; expiresAt: number }
  | { state: "expired" | "revoked" };

function parse<T>(s: unknown, fallback: T): T {
  try {
    return JSON.parse(String(s)) as T;
  } catch {
    return fallback;
  }
}

/** Страница отчёта для владельца заведения. countView: считать ли показ (не считаем, когда смотрит сам автор). */
export async function getPublicReport(token: string, countView = true): Promise<PublicReport | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const db = await appDb();
  const r = (await db.execute({ sql: "SELECT * FROM audit_reports WHERE token = ?", args: [token] })).rows[0];
  if (!r) return null;
  if (Number(r.revoked) === 1) return { state: "revoked" };
  if (Number(r.expires_at) <= now()) return { state: "expired" };
  if (countView) await db.execute({ sql: "UPDATE audit_reports SET views = views + 1 WHERE token = ?", args: [token] }).catch(() => {});
  return {
    state: "ok",
    leadName: String(r.lead_name),
    siteUrl: String(r.site_url),
    findings: parse<Finding[]>(r.findings, []),
    profile: { name: "", contact: "", skills: "", portfolio: "", priceFrom: "", ...parse<Partial<ReportProfile>>(r.profile, {}) },
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
  };
}

export type ReportRow = { token: string; createdAt: number; expiresAt: number; views: number; revoked: boolean };

/** Отчёты автора по заведению: действующие и недавние, с числом просмотров. */
export async function listReports(userId: number, leadId: string): Promise<ReportRow[]> {
  const db = await appDb();
  const rs = await db.execute({
    sql: "SELECT token, created_at, expires_at, views, revoked FROM audit_reports WHERE user_id = ? AND lead_id = ? ORDER BY created_at DESC LIMIT 10",
    args: [userId, leadId],
  });
  return rs.rows.map((r) => ({ token: String(r.token), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), views: Number(r.views), revoked: Number(r.revoked) === 1 }));
}

/** Отозвать ссылку: страница перестаёт открываться, а использованная квота не возвращается. */
export async function revokeReport(userId: number, token: string): Promise<boolean> {
  const db = await appDb();
  const r = await db.execute({ sql: "UPDATE audit_reports SET revoked = 1 WHERE token = ? AND user_id = ? AND revoked = 0", args: [token, userId] });
  return r.rowsAffected === 1;
}

export async function isReportOwner(userId: number, token: string): Promise<boolean> {
  const db = await appDb();
  return (await db.execute({ sql: "SELECT 1 FROM audit_reports WHERE token = ? AND user_id = ?", args: [token, userId] })).rows.length > 0;
}

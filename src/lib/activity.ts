import { userLabel } from "./auth";
import { STATUS_LABEL } from "./crm";
import { appDb, leadsDb } from "./db";
import { adminUserIds, isAdminEmail } from "./metrics";
import { fmtRub, getPlan } from "./plans";
import { getSubscriptions, type SubscriptionInfo } from "./subscriptions";

/**
 * Активность пользователей для владельца: лента действий, сводка «кто заходил» и карточка одного человека.
 * Отдельного журнала нет: события собираются из таблиц, где они и так записаны (регистрации, сессии, открытия, платежи,
 * проводки кредитов, питчи, статусы лидов, отчёты). Поэтому входы видны только по ещё живым сессиям (выход стирает сессию),
 * а у питча и статуса лида хранится только последний вариант. Ничего не пишет в базу.
 */

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

export const KINDS = ["signup", "login", "unlock", "payment", "credits", "pitch", "crm", "report"] as const;
export type ActivityKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<ActivityKind, string> = {
  signup: "Регистрации", login: "Входы", unlock: "Открытия", payment: "Оплаты", credits: "Кредиты", pitch: "Питчи", crm: "Статусы лидов", report: "Отчёты",
};
export const isKind = (v: unknown): v is ActivityKind => KINDS.includes(v as ActivityKind);

export type ActivityEvent = { at: number; userId: number; user: string; kind: ActivityKind; text: string; leadId: string | null; leadName: string | null };

const PAY_STATUS: Record<string, string> = { pending: "оплата начата", succeeded: "оплата прошла", canceled: "оплата отменена", failed: "оплата не прошла" };
const LEDGER: Record<string, string> = {
  signup_bonus: "бонус за Telegram", subscription: "кредиты по подписке", exclusive: "эксклюзив на заведение", report: "отчёт для клиента",
  account_deleted: "аккаунт удалён, кредиты сгорели", promo: "промокод", referral: "награда за приглашённого", admin: "начисление от вас",
};
const CHANNEL: Record<string, string> = { telegram: "Telegram", whatsapp: "WhatsApp", email: "e-mail", call: "звонок" };

// Одна строка на событие: время, кто, что и до пяти полей подробностей; s3 у событий про заведение — его id.
// Имена колонок у объединения берутся из первого запроса, а он зависит от фильтра, поэтому имена даны в каждом.
const row = (at: string, kind: ActivityKind, s1: string, s2: string, s3: string, n1: string, n2: string, rest: string, user = "user_id") =>
  `SELECT ${at} AS at, ${user} AS user_id, '${kind}' AS kind, ${s1} AS s1, ${s2} AS s2, ${s3} AS s3, ${n1} AS n1, ${n2} AS n2 ${rest}`;
const SOURCES: Record<ActivityKind, string> = {
  signup: row("created_at", "signup", "NULL", "NULL", "NULL", "NULL", "NULL", "FROM users", "id"),
  login: row("created_at", "login", "NULL", "NULL", "NULL", "NULL", "NULL", "FROM sessions"),
  unlock: row("created_at", "unlock", "NULL", "NULL", "lead_id", "NULL", "NULL", "FROM unlocks"),
  // s2: тариф, у пробной недели с пометкой trial:, у списания автопродления auto:
  payment: row("created_at", "payment", "status", "CASE WHEN kind = 'trial' THEN 'trial:' || plan_id WHEN package_id LIKE 'autorenew:%' THEN 'auto:' || plan_id ELSE plan_id END", "provider", "amount_kop", "CASE WHEN kind = 'subscription' THEN months ELSE credits END", "FROM payments"),
  // Открытия и пополнения уже есть отдельными событиями, их проводки не дублируем
  credits: row("created_at", "credits", "reason", "ref", "NULL", "delta", "NULL", "FROM ledger WHERE reason NOT IN ('unlock', 'purchase')"),
  pitch: row("created_at", "pitch", "channel", "source", "lead_id", "NULL", "NULL", "FROM lead_pitches"),
  crm: row("updated_at", "crm", "status", "CASE WHEN note <> '' THEN 1 END", "lead_id", "NULL", "NULL", "FROM lead_notes"),
  report: row("created_at", "report", "NULL", "lead_name", "lead_id", "views", "NULL", "FROM audit_reports"),
};

const str = (v: unknown) => (v == null ? null : String(v));
/** Как в админке: почта или @username, а у удалённого аккаунта вместо служебного адреса понятная подпись. */
const who = (r: Record<string, unknown>) =>
  String(r.email).endsWith("@deleted.invalid") ? "удалённый аккаунт" : userLabel(String(r.email), str(r.tg_username), str(r.display_name));
const rub = (kop: number) => fmtRub(kop / 100);

function describe(kind: ActivityKind, r: Record<string, unknown>): string {
  const s1 = str(r.s1), s2 = str(r.s2), n1 = Number(r.n1 ?? 0), n2 = Number(r.n2 ?? 0);
  switch (kind) {
    case "signup": return "регистрация";
    case "login": return "вход на сайт";
    case "unlock": return "открыты контакты";
    case "payment": {
      const [tag, plan] = s2?.includes(":") ? s2.split(":") : [null, s2];
      const title = plan ? getPlan(plan)?.title ?? plan : "";
      const what = tag === "trial" ? `пробная неделя «${title}»` : tag === "auto" ? `автопродление «${title}» на ${n2} мес.` : plan ? `подписку «${title}» на ${n2} мес.` : `${n2} кредитов`;
      return `${PAY_STATUS[s1 ?? ""] ?? s1}: ${what}, ${rub(n1)}${str(r.s3) === "yookassa" ? "" : " (тест)"}`;
    }
    case "credits": {
      const why = LEDGER[s1 ?? ""] ?? s1 ?? "";
      const note = s1 === "admin" && s2 ? ` (${s2})` : s1 === "promo" && s2 ? ` ${s2}` : "";
      return `${n1 > 0 ? "+" : ""}${n1} кр. — ${why}${note}`;
    }
    case "pitch": return `питч${s1 ? ` для ${CHANNEL[s1] ?? s1}` : ""}${s2 === "claude" ? " с ИИ" : ""}`;
    case "crm": return `статус лида: «${STATUS_LABEL[s1 ?? ""] ?? s1}»${s2 ? ", есть заметка" : ""}`;
    case "report": return `отчёт для клиента${n1 > 0 ? `, просмотров: ${n1}` : ""}`;
  }
}

/** Названия заведений из каталога для показа в ленте. Если заведения уже нет в каталоге, будет только id. */
async function leadNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  try {
    const rs = await leadsDb().execute({ sql: `SELECT id, name, city FROM places WHERE id IN (${uniq.map(() => "?").join(",")})`, args: uniq });
    return new Map(rs.rows.map((r) => [String(r.id), r.city ? `${r.name}, ${r.city}` : String(r.name)]));
  } catch {
    return new Map();
  }
}

/**
 * Лента событий, новые сверху. userId: только этот человек (тогда и владелец виден); kinds: только эти виды;
 * before: события старше этого времени (для «показать ещё»); withOwner: показывать и аккаунты владельца.
 */
export async function getActivity(opts: { userId?: number; kinds?: ActivityKind[]; before?: number; limit?: number; withOwner?: boolean } = {}): Promise<ActivityEvent[]> {
  const db = await appDb();
  const kinds = opts.kinds?.length ? opts.kinds : [...KINDS];
  const where: string[] = [];
  const args: (number | string)[] = [];
  if (opts.userId != null) { where.push("e.user_id = ?"); args.push(opts.userId); }
  else if (!opts.withOwner) {
    // Действия владельца по умолчанию не показываем, чтобы лента была про клиентов
    const own = await adminUserIds(db);
    if (own.length) where.push(`e.user_id NOT IN (${own.join(",")})`);
  }
  if (opts.before != null) { where.push("e.at < ?"); args.push(opts.before); }
  const rs = await db.execute({
    sql: `SELECT e.*, u.email, u.tg_username, u.display_name FROM (${kinds.map((k) => SOURCES[k]).join(" UNION ALL ")}) e
          JOIN users u ON u.id = e.user_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY e.at DESC LIMIT ?`,
    args: [...args, Math.min(Math.max(opts.limit ?? 100, 1), 500)],
  });
  const rows = (rs.rows as unknown as Record<string, unknown>[]).map((r) => ({ r, kind: r.kind as ActivityKind }));
  // s3 у платежей — провайдер, а не заведение, поэтому id берём только из событий про заведения
  const leadOf = (x: { r: Record<string, unknown>; kind: ActivityKind }) => (LEAD_KINDS.has(x.kind) ? str(x.r.s3) : null);
  const names = await leadNames(rows.map(leadOf).filter((x): x is string => x != null));
  return rows.map((x) => {
    const leadId = leadOf(x);
    return {
      at: Number(x.r.at), userId: Number(x.r.user_id), kind: x.kind, text: describe(x.kind, x.r),
      user: who(x.r),
      leadId, leadName: leadId ? names.get(leadId) ?? (x.kind === "report" ? str(x.r.s2) : null) : null,
    };
  });
}

const LEAD_KINDS = new Set<ActivityKind>(["unlock", "pitch", "crm", "report"]);

export type ActivitySummary = {
  online: number; day: number; week: number; month: number;
  /** С какого момента записывается время захода: раньше его не было, и старые аккаунты до первого визита не считаются */
  trackedSince: number | null;
  top: { userId: number; user: string; events: number; lastSeenAt: number | null }[];
};

/** Сколько людей заходило (по времени последнего визита) и кто самый активный за неделю. Без аккаунтов владельца. */
export async function getActivitySummary(t = now()): Promise<ActivitySummary> {
  const db = await appDb();
  const own = await adminUserIds(db);
  const notOwn = (col: string) => (own.length ? ` AND ${col} NOT IN (${own.join(",")})` : "");
  const seen = async (since: number) =>
    Number((await db.execute({ sql: `SELECT count(*) AS n FROM users WHERE last_seen_at > ?${notOwn("id")}`, args: [since] })).rows[0].n);
  const [online, day, week, month] = await Promise.all([seen(t - 300), seen(t - DAY), seen(t - 7 * DAY), seen(t - 30 * DAY)]);
  const first = (await db.execute("SELECT min(last_seen_at) AS t FROM users")).rows[0]?.t;

  // Действия за неделю: открытия, питчи, статусы лидов, отчёты и платежи
  const since = t - 7 * DAY;
  const top = (
    await db.execute({
      sql: `SELECT e.user_id, count(*) AS n, u.email, u.tg_username, u.display_name, u.last_seen_at FROM (
              SELECT user_id FROM unlocks WHERE created_at > ?
              UNION ALL SELECT user_id FROM lead_pitches WHERE created_at > ?
              UNION ALL SELECT user_id FROM lead_notes WHERE updated_at > ?
              UNION ALL SELECT user_id FROM audit_reports WHERE created_at > ?
              UNION ALL SELECT user_id FROM payments WHERE created_at > ?
            ) e JOIN users u ON u.id = e.user_id WHERE u.deleted_at IS NULL${notOwn("e.user_id")}
            GROUP BY e.user_id ORDER BY n DESC, u.last_seen_at DESC LIMIT 10`,
      args: [since, since, since, since, since],
    })
  ).rows.map((r) => ({
    userId: Number(r.user_id), events: Number(r.n), lastSeenAt: r.last_seen_at == null ? null : Number(r.last_seen_at),
    user: who(r),
  }));
  return { online, day, week, month, trackedSince: first == null ? null : Number(first), top };
}

export type UserProfile = {
  id: number; email: string; user: string; createdAt: number; lastSeenAt: number | null; balance: number;
  banned: boolean; deleted: boolean; isAdmin: boolean; telegram: boolean;
  unlocks: number; pitches: number; reports: number; sessions: number; paidRub: number; referrals: number;
  subscriptions: SubscriptionInfo[];
};

/** Всё о человеке на одной карточке: когда пришёл и заходил, сколько открыл и заплатил, какая подписка. */
export async function getUserProfile(userId: number, t = now()): Promise<UserProfile | null> {
  const db = await appDb();
  const r = (
    await db.execute({
      sql: `SELECT u.*,
              (SELECT count(*) FROM unlocks WHERE user_id = u.id) AS n_unlocks,
              (SELECT count(*) FROM lead_pitches WHERE user_id = u.id) AS n_pitches,
              (SELECT count(*) FROM audit_reports WHERE user_id = u.id) AS n_reports,
              (SELECT count(*) FROM sessions WHERE user_id = u.id AND expires_at > ?) AS n_sessions,
              (SELECT count(*) FROM users r WHERE r.referred_by = u.id) AS n_refs,
              (SELECT coalesce(sum(amount_kop), 0) FROM payments WHERE user_id = u.id AND status = 'succeeded' AND provider = 'yookassa') AS paid
            FROM users u WHERE u.id = ?`,
      args: [t, userId],
    })
  ).rows[0];
  if (!r) return null;
  const email = String(r.email);
  return {
    id: userId, email, user: who(r), createdAt: Number(r.created_at),
    lastSeenAt: r.last_seen_at == null ? null : Number(r.last_seen_at), balance: Number(r.balance),
    banned: r.banned_at != null, deleted: r.deleted_at != null, isAdmin: isAdminEmail(email), telegram: r.tg_id != null,
    unlocks: Number(r.n_unlocks), pitches: Number(r.n_pitches), reports: Number(r.n_reports), sessions: Number(r.n_sessions),
    paidRub: Number(r.paid) / 100, referrals: Number(r.n_refs), subscriptions: await getSubscriptions(userId),
  };
}

/** «только что», «12 мин назад», «3 ч назад», «вчера в 14:05», дальше дата. */
export function ago(ts: number, t = now()): string {
  const d = t - ts;
  if (d < 60) return "только что";
  if (d < 3600) return `${Math.floor(d / 60)} мин назад`;
  if (d < DAY) return `${Math.floor(d / 3600)} ч назад`;
  const time = new Date(ts * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  if (d < 2 * DAY) return `вчера в ${time}`;
  return new Date(ts * 1000).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
}

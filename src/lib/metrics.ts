import { appDb, leadsDb } from "./db";

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

export type Metrics = {
  users: { total: number; d7: number; d30: number; active7: number; payers: number };
  money: { revenueRub: number; revenue30Rub: number; payments: number; pending: number; failed: number; creditsSold: number };
  usage: { unlocks: number; unlocks7: number; creditsLeft: number };
  signupsByDay: { day: string; n: number }[];
  topNiches: { niche: string; n: number }[];
  recentPayments: { email: string; credits: number; amountRub: number; status: string; at: number }[];
};

const num = (v: unknown) => Number(v ?? 0);

/** Для владельца: сколько людей пришло, сколько заплатило и что открывают. Ничего не пишет в базу. */
export async function getMetrics(): Promise<Metrics> {
  const db = await appDb();
  const t = now();
  const one = async (sql: string, args: (string | number)[] = []) => (await db.execute({ sql, args })).rows[0];

  const [u, d7, d30, active7, payers, rev, rev30, pays, pend, fail, sold, un, un7, left] = await Promise.all([
    one("SELECT count(*) AS n FROM users"),
    one("SELECT count(*) AS n FROM users WHERE created_at > ?", [t - 7 * DAY]),
    one("SELECT count(*) AS n FROM users WHERE created_at > ?", [t - 30 * DAY]),
    one("SELECT count(DISTINCT user_id) AS n FROM unlocks WHERE created_at > ?", [t - 7 * DAY]),
    one("SELECT count(DISTINCT user_id) AS n FROM payments WHERE status = 'succeeded'"),
    one("SELECT coalesce(sum(amount_kop), 0) AS n FROM payments WHERE status = 'succeeded' AND provider = 'yookassa'"),
    one("SELECT coalesce(sum(amount_kop), 0) AS n FROM payments WHERE status = 'succeeded' AND provider = 'yookassa' AND paid_at > ?", [t - 30 * DAY]),
    one("SELECT count(*) AS n FROM payments WHERE status = 'succeeded' AND provider = 'yookassa'"),
    one("SELECT count(*) AS n FROM payments WHERE status = 'pending'"),
    one("SELECT count(*) AS n FROM payments WHERE status IN ('failed', 'canceled')"),
    one("SELECT coalesce(sum(credits), 0) AS n FROM payments WHERE status = 'succeeded' AND provider = 'yookassa'"),
    one("SELECT count(*) AS n FROM unlocks"),
    one("SELECT count(*) AS n FROM unlocks WHERE created_at > ?", [t - 7 * DAY]),
    one("SELECT coalesce(sum(balance), 0) AS n FROM users"),
  ]);

  const days = (
    await db.execute({
      sql: `SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, count(*) AS n FROM users
            WHERE created_at > ? GROUP BY 1 ORDER BY 1 DESC`,
      args: [t - 14 * DAY],
    })
  ).rows.map((r) => ({ day: String(r.day), n: num(r.n) }));

  // Какие ниши открывают чаще: берём последние открытия и смотрим их нишу в каталоге.
  const recentIds = (await db.execute("SELECT lead_id FROM unlocks ORDER BY created_at DESC LIMIT 500")).rows.map((r) => String(r.lead_id));
  let topNiches: { niche: string; n: number }[] = [];
  if (recentIds.length) {
    const rs = await leadsDb().execute({
      sql: `SELECT niche, count(*) AS n FROM places WHERE id IN (${recentIds.map(() => "?").join(",")}) GROUP BY niche ORDER BY n DESC LIMIT 8`,
      args: recentIds,
    });
    topNiches = rs.rows.map((r) => ({ niche: String(r.niche), n: num(r.n) }));
  }

  const recent = (
    await db.execute(
      `SELECT u.email, p.credits, p.amount_kop, p.status, p.created_at FROM payments p JOIN users u ON u.id = p.user_id
       WHERE p.provider = 'yookassa' ORDER BY p.created_at DESC LIMIT 10`,
    )
  ).rows.map((r) => ({ email: maskEmail(String(r.email)), credits: num(r.credits), amountRub: num(r.amount_kop) / 100, status: String(r.status), at: num(r.created_at) }));

  return {
    users: { total: num(u.n), d7: num(d7.n), d30: num(d30.n), active7: num(active7.n), payers: num(payers.n) },
    money: {
      revenueRub: num(rev.n) / 100, revenue30Rub: num(rev30.n) / 100, payments: num(pays.n), pending: num(pend.n), failed: num(fail.n), creditsSold: num(sold.n),
    },
    usage: { unlocks: num(un.n), unlocks7: num(un7.n), creditsLeft: num(left.n) },
    signupsByDay: days,
    topNiches,
    recentPayments: recent,
  };
}

function maskEmail(e: string): string {
  const [name, host] = e.split("@");
  return `${name.slice(0, 2)}•••@${host ?? ""}`;
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

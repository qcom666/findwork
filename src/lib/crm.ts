import { appDb } from "./db";

/** Этапы работы с лидом. Меняются только у открытых пользователем лидов. */
export const STATUSES = [
  { id: "new", label: "Новый" },
  { id: "contacted", label: "Написал" },
  { id: "replied", label: "Ответили" },
  { id: "won", label: "Сделка" },
  { id: "lost", label: "Отказ" },
] as const;

export type StatusId = (typeof STATUSES)[number]["id"];
export const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
export const isStatus = (v: unknown): v is StatusId => STATUSES.some((s) => s.id === v);

export const NOTE_MAX = 1000;
const now = () => Math.floor(Date.now() / 1000);

export type Crm = { status: StatusId; note: string };

export async function getCrm(userId: number, leadIds: string[]): Promise<Map<string, Crm>> {
  const out = new Map<string, Crm>();
  if (!leadIds.length) return out;
  const db = await appDb();
  const r = await db.execute({
    sql: `SELECT lead_id, status, note FROM lead_notes WHERE user_id = ? AND lead_id IN (${leadIds.map(() => "?").join(",")})`,
    args: [userId, ...leadIds],
  });
  for (const x of r.rows) out.set(String(x.lead_id), { status: isStatus(x.status) ? x.status : "new", note: String(x.note) });
  return out;
}

/** Меняет статус и/или заметку. Что не передано, то остаётся как было. */
export async function saveCrm(userId: number, leadId: string, patch: { status?: StatusId; note?: string }): Promise<void> {
  const db = await appDb();
  const status = patch.status ?? null;
  const note = patch.note === undefined ? null : patch.note.slice(0, NOTE_MAX);
  await db.execute({
    sql: `INSERT INTO lead_notes(user_id, lead_id, status, note, updated_at) VALUES (?, ?, coalesce(?, 'new'), coalesce(?, ''), ?)
          ON CONFLICT(user_id, lead_id) DO UPDATE SET
            status = coalesce(?, lead_notes.status),
            note = coalesce(?, lead_notes.note),
            updated_at = excluded.updated_at`,
    args: [userId, leadId, status, note, now(), status, note],
  });
}

/** Сколько открытых лидов на каждом этапе. Лид без записи считается новым. */
export async function countByStatus(userId: number): Promise<Record<string, number>> {
  const db = await appDb();
  const r = await db.execute({
    sql: `SELECT coalesce(n.status, 'new') AS status, count(*) AS k
          FROM unlocks u LEFT JOIN lead_notes n ON n.user_id = u.user_id AND n.lead_id = u.lead_id
          WHERE u.user_id = ? GROUP BY 1`,
    args: [userId],
  });
  const out: Record<string, number> = {};
  for (const x of r.rows) out[String(x.status)] = Number(x.k);
  return out;
}

export async function listUnlockedIdsByStatus(userId: number, status: StatusId | "", limit: number, offset = 0): Promise<string[]> {
  const db = await appDb();
  const r = await db.execute({
    sql: `SELECT u.lead_id FROM unlocks u LEFT JOIN lead_notes n ON n.user_id = u.user_id AND n.lead_id = u.lead_id
          WHERE u.user_id = ? ${status ? "AND coalesce(n.status, 'new') = ?" : ""}
          ORDER BY u.created_at DESC, u.rowid DESC LIMIT ? OFFSET ?`,
    args: status ? [userId, status, limit, offset] : [userId, limit, offset],
  });
  return r.rows.map((x) => String(x.lead_id));
}

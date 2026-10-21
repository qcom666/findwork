import { appDb } from "./db";

export type SavedPitch = {
  leadId: string;
  service: string;
  channel: string;
  subject: string;
  message: string;
  followup: string;
  angle: string;
  source: "claude" | "template";
  createdAt: number;
};

const now = () => Math.floor(Date.now() / 1000);

/** Последний питч по заведению у этого пользователя. Новый заменяет прежний. */
export async function savePitch(
  userId: number,
  leadId: string,
  p: { service: string; channel: string; subject: string; message: string; followup: string; angle: string; source: "claude" | "template" },
): Promise<void> {
  const db = await appDb();
  await db.execute({
    sql: `INSERT INTO lead_pitches(user_id, lead_id, service, channel, subject, message, followup, angle, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, lead_id) DO UPDATE SET
            service = excluded.service, channel = excluded.channel, subject = excluded.subject, message = excluded.message,
            followup = excluded.followup, angle = excluded.angle, source = excluded.source, created_at = excluded.created_at`,
    args: [userId, leadId, p.service, p.channel, p.subject.slice(0, 300), p.message.slice(0, 4000), p.followup.slice(0, 2000), p.angle.slice(0, 600), p.source, now()],
  });
}

export async function getPitches(userId: number, leadIds: string[]): Promise<Map<string, SavedPitch>> {
  const out = new Map<string, SavedPitch>();
  if (!leadIds.length) return out;
  const db = await appDb();
  const r = await db.execute({
    sql: `SELECT lead_id, service, channel, subject, message, followup, angle, source, created_at FROM lead_pitches
          WHERE user_id = ? AND lead_id IN (${leadIds.map(() => "?").join(",")})`,
    args: [userId, ...leadIds],
  });
  for (const x of r.rows) {
    out.set(String(x.lead_id), {
      leadId: String(x.lead_id), service: String(x.service), channel: String(x.channel), subject: String(x.subject), message: String(x.message),
      followup: String(x.followup), angle: String(x.angle), source: x.source === "claude" ? "claude" : "template", createdAt: Number(x.created_at),
    });
  }
  return out;
}

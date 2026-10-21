import { BATCH_MAX, generateBatch } from "@/lib/batch";
import { json, needUser, readJson } from "@/lib/http";
import type { Channel, Profile } from "@/lib/pitch";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHANNELS: Channel[] = ["telegram", "whatsapp", "email", "call"];
const cut = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function POST(req: Request) {
  const b = await readJson<{ ids?: unknown; service?: unknown; channel?: unknown; profile?: Partial<Profile> }>(req);
  if (!Array.isArray(b?.ids) || b.ids.length === 0 || b.ids.length > BATCH_MAX || !b.ids.every((x) => typeof x === "string" && x.length < 80)) {
    return json({ error: `Передайте от 1 до ${BATCH_MAX} заведений за раз` }, 400);
  }
  const auth = await needUser();
  if ("error" in auth) return auth.error;

  const limit = parseInt(process.env.PITCH_HOURLY_LIMIT ?? "60", 10) || 60;
  if (!(await allow(`pitch:${auth.user.id}`, limit, 3600, b.ids.length))) {
    return json({ error: `Лимит ${limit} питчей в час. Попробуйте позже.` }, 429);
  }

  const profile: Profile = {
    name: cut(b.profile?.name, 60), skills: cut(b.profile?.skills, 200), portfolio: cut(b.profile?.portfolio, 200), priceFrom: cut(b.profile?.priceFrom, 40),
  };
  const channel = CHANNELS.includes(b.channel as Channel) ? (b.channel as Channel) : "telegram";
  const results = await generateBatch({ userId: auth.user.id, ids: b.ids as string[], service: cut(b.service, 30) || "auto", channel, profile });
  return json({ results });
}

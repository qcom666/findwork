import { banUser, getAdmin, unbanUser } from "@/lib/admin";
import { json, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Блокировка и разблокировка. Тело: {userId, ban: true, reason?, zero?} или {userId, ban: false}. */
export async function POST(req: Request) {
  const admin = await getAdmin();
  if (!admin) return json({ error: "not found" }, 404);
  const b = await readJson<{ userId?: number; ban?: boolean; reason?: string; zero?: boolean }>(req);
  if (!b || !Number.isInteger(b.userId) || typeof b.ban !== "boolean") return json({ error: "Укажите пользователя" }, 400);
  if (b.userId === admin.id) return json({ error: "Себя заблокировать нельзя" }, 400);
  if (!(await allow(`admin-ban:${admin.id}`, 120, 3600))) return json({ error: "Слишком часто, подождите" }, 429);

  if (!b.ban) return (await unbanUser(Number(b.userId))).ok ? json({ ok: true }) : json({ error: "Пользователь не заблокирован" }, 404);
  const r = await banUser(Number(b.userId), String(b.reason ?? ""), { zero: b.zero === true });
  return r.ok ? json({ ok: true, taken: r.taken ?? 0 }) : json({ error: r.error }, 400);
}

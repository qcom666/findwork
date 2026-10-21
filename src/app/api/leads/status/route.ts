import { isStatus, NOTE_MAX, saveCrm } from "@/lib/crm";
import { isUnlocked } from "@/lib/credits";
import { json, needUser, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ id?: string; status?: unknown; note?: unknown }>(req);
  if (!b?.id || typeof b.id !== "string") return json({ error: "Не указан id" }, 400);
  if (b.status !== undefined && !isStatus(b.status)) return json({ error: "Неизвестный статус" }, 400);
  if (b.note !== undefined && (typeof b.note !== "string" || b.note.length > NOTE_MAX)) return json({ error: `Заметка не длиннее ${NOTE_MAX} символов` }, 400);

  const auth = await needUser();
  if ("error" in auth) return auth.error;
  if (!(await allow(`crm:${auth.user.id}`, 600, 3600))) return json({ error: "Слишком часто, подождите" }, 429);
  if (!(await isUnlocked(auth.user.id, b.id))) return json({ error: "Сначала откройте контакты заведения" }, 403);

  await saveCrm(auth.user.id, b.id, { status: b.status as never, note: b.note as string | undefined });
  return json({ ok: true });
}

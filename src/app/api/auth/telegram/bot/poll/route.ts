import { cookies } from "next/headers";
import { getCurrentUser, startSession } from "@/lib/auth";
import { json, readJson } from "@/lib/http";
import { allow, clientIp } from "@/lib/ratelimit";
import { pollLoginRequest } from "@/lib/tg-login";

export const runtime = "nodejs";

/**
 * Опрос состояния входа через бота. Тело: {token, accept?, consent?, confirm?}.
 * waiting: ждём, пока человек подтвердит в Telegram; needConsent / needConfirm: нужны ваши отметки; done: вход выполнен.
 */
export async function POST(req: Request) {
  const b = await readJson<{ token?: string; accept?: boolean; consent?: boolean; confirm?: boolean }>(req);
  if (!b || typeof b.token !== "string") return json({ error: "Некорректный запрос" }, 400);
  const ip = clientIp(req);
  if (!(await allow(`tgbot-poll:${ip}`, 500, 900))) return json({ error: "Слишком много запросов, подождите" }, 429);

  const user = await getCurrentUser();
  const r = await pollLoginRequest(b.token, {
    userId: user?.id,
    refCode: (await cookies()).get("fw_ref")?.value ?? null,
    accept: b.accept === true, consent: b.consent === true, confirm: b.confirm === true,
    canCreate: () => allow(`signup:${ip}`, 5, 3600),
  });

  if (r.status === "done") {
    if (r.mode === "login") await startSession(r.userId);
    return json({ status: "done", created: r.created, merged: r.merged });
  }
  if (r.status === "error") return json({ status: "error", error: r.error }, 409);
  return json(r);
}

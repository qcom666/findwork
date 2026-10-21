import { signInWithTelegram } from "@/lib/auth";
import { json, readJson } from "@/lib/http";
import { LEGAL_VERSION } from "@/lib/legal";
import { allow, clientIp } from "@/lib/ratelimit";
import { telegramConfigured, verifyTelegramLogin } from "@/lib/telegram";

export const runtime = "nodejs";

/**
 * Вход и регистрация через Telegram. Тело: {auth: данные виджета, accept?, consent?}.
 * Есть аккаунт: входим без вопросов. Нет аккаунта и нет согласий: отвечаем needConsent, страница спрашивает
 * согласие отдельным действием и присылает те же данные виджета повторно (они действительны 10 минут).
 */
export async function POST(req: Request) {
  const b = await readJson<{ auth?: unknown; accept?: boolean; consent?: boolean }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  if (!telegramConfigured()) return json({ error: "Вход через Telegram пока не настроен" }, 503);

  const ip = clientIp(req);
  if (!(await allow(`tglogin:${ip}`, 30, 900))) return json({ error: "Слишком много попыток входа. Подождите 15 минут." }, 429);

  const v = verifyTelegramLogin(b.auth);
  if (!v.ok) {
    return json(
      { error: v.reason === "expired" ? "Данные входа устарели. Нажмите кнопку Telegram ещё раз." : "Не удалось проверить вход через Telegram" },
      400,
    );
  }

  const r = await signInWithTelegram(v.user, {
    consentVersion: b.accept === true && b.consent === true ? LEGAL_VERSION : null,
    canCreate: () => allow(`signup:${ip}`, 5, 3600),
  });
  if (r.ok) return json({ ok: true, created: r.created });
  if (r.needConsent) return json({ needConsent: true });
  return json({ error: r.error }, 429);
}

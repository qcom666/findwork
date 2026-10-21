import { linkTelegram } from "@/lib/account-link";
import { json, needUser, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";
import { telegramConfigured, verifyTelegramLogin } from "@/lib/telegram";

export const runtime = "nodejs";

/**
 * Привязка Telegram к аккаунту, в который вы вошли. Тело: {auth: данные виджета, confirm?}.
 * Если этот Telegram уже заходил на сайт отдельно, отвечаем needConfirm со сводкой того, что перенесётся,
 * и объединяем только после повторного запроса с confirm: true (данные виджета действительны 10 минут).
 */
export async function POST(req: Request) {
  const b = await readJson<{ auth?: unknown; confirm?: boolean }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  if (!telegramConfigured()) return json({ error: "Вход через Telegram пока не настроен" }, 503);
  if (!(await allow(`tglink:${auth.user.id}`, 20, 3600))) return json({ error: "Слишком много попыток, подождите" }, 429);

  const v = verifyTelegramLogin(b.auth);
  if (!v.ok) {
    return json({ error: v.reason === "expired" ? "Данные входа устарели. Нажмите кнопку Telegram ещё раз." : "Не удалось проверить вход через Telegram" }, 400);
  }

  const r = await linkTelegram(auth.user.id, v.user, { confirm: b.confirm === true });
  if (r.ok) return json({ ok: true, merged: r.merged });
  switch (r.reason) {
    case "needConfirm": return json({ needConfirm: true, info: r.info });
    case "already": return json({ error: "Этот Telegram уже привязан к вашему аккаунту" }, 409);
    case "other_tg": return json({ error: "К вашему аккаунту уже привязан другой Telegram. Сначала отвяжите его." }, 409);
    case "taken": return json({ error: "Этот Telegram привязан к другому аккаунту с почтой. Войдите в него и отвяжите Telegram там, затем повторите." }, 409);
    case "synthetic": return json({ error: "Этот аккаунт уже работает через Telegram" }, 409);
    default: return json({ error: "Аккаунт не найден" }, 404);
  }
}

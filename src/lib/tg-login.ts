import { createHash, randomBytes } from "node:crypto";
import { linkMessage, linkTelegram, type MergeInfo } from "./account-link";
import { appDb } from "./db";
import { LEGAL_VERSION } from "./legal";
import type { TgUser } from "./telegram";
import { botLink, tgApi } from "./telegram-bot";
import { loginOrCreateTelegramUser } from "./users";

/**
 * Вход и привязка через бота. Браузер получает одноразовую ссылку на бота, человек нажимает
 * Start и подтверждает «это вы» в Telegram, а браузер всё это время опрашивает сервер (pollLoginRequest).
 * Секрет в ссылке одноразовый и живёт 10 минут; в базе лежит только его хеш. В вопросе боту видно, откуда пришёл запрос
 * (браузер и IP), чтобы человек мог отказать, если ссылку ему прислал кто-то другой.
 */
const now = () => Math.floor(Date.now() / 1000);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const LOGIN_TTL = 600;

export type LoginMode = "login" | "link";

export async function createLoginRequest(o: { mode: LoginMode; userId?: number; ip: string; ua: string }): Promise<{ token: string; url: string; ttl: number }> {
  const db = await appDb();
  const t = now();
  const token = randomBytes(24).toString("base64url");
  await db.batch(
    [
      { sql: "DELETE FROM tg_login_requests WHERE expires_at < ?", args: [t - 86400] },
      {
        sql: "INSERT INTO tg_login_requests(token_hash, mode, user_id, ip, ua, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: [sha(token), o.mode, o.userId ?? null, o.ip.slice(0, 64), o.ua.slice(0, 300), t, t + LOGIN_TTL],
      },
    ],
    "write",
  );
  return { token, url: botLink(`${o.mode}_${token}`), ttl: LOGIN_TTL };
}

/** «Safari, iOS»: коротко, по User-Agent. Нужно только для вопроса человеку в Telegram. */
export function uaLabel(ua: string): string {
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(", ") || "неизвестный браузер";
}

type From = { id?: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
const toTg = (f: From): TgUser | null => {
  if (!Number.isSafeInteger(f.id) || (f.id as number) <= 0 || f.is_bot) return null;
  const name = [f.first_name, f.last_name].filter(Boolean).join(" ").trim().slice(0, 100) || null;
  return { id: f.id as number, name, username: f.username && /^[A-Za-z0-9_]{1,32}$/.test(f.username) ? f.username : null };
};

const HELP =
  "Это бот входа на Lidomap. Чтобы войти, вернитесь на сайт и нажмите «Войти через бота», затем здесь нажмите Start. Других команд у меня нет.";

const say = (chat_id: number, text: string, extra: Record<string, unknown> = {}) => tgApi("sendMessage", { chat_id, text, ...extra });

/**
 * Разбирает обновление от Telegram (вебхук). Ошибки отправки сообщений не должны ломать обработку: вебхуку всегда отвечаем 200,
 * иначе Telegram будет присылать то же обновление снова.
 */
export async function handleBotUpdate(update: unknown): Promise<void> {
  const u = (update ?? {}) as {
    message?: { chat?: { id?: number; type?: string }; from?: From; text?: string };
    callback_query?: { id?: string; from?: From; data?: string; message?: { chat?: { id?: number }; message_id?: number } };
  };
  const db = await appDb();
  const t = now();

  const msg = u.message;
  if (msg?.chat?.type === "private" && typeof msg.chat.id === "number" && typeof msg.text === "string") {
    const chat = msg.chat.id;
    const tg = toTg(msg.from ?? {});
    const m = /^\/start(?:@[A-Za-z0-9_]+)?\s+(login|link)_([A-Za-z0-9_-]{20,64})\s*$/.exec(msg.text.trim());
    if (!tg || !m) return void (await say(chat, HELP).catch(() => {}));

    const hash = sha(m[2]);
    const row = (await db.execute({ sql: "SELECT mode, state, tg_id, ip, ua, created_at FROM tg_login_requests WHERE token_hash = ? AND expires_at > ?", args: [hash, t] })).rows[0];
    const free = row && String(row.mode) === m[1] && (String(row.state) === "pending" || (String(row.state) === "asked" && Number(row.tg_id) === tg.id));
    if (!free) return void (await say(chat, "Эта ссылка устарела или уже использована. Вернитесь на сайт и запросите новую.").catch(() => {}));

    await db.execute({ sql: "UPDATE tg_login_requests SET state = 'asked', tg_id = ?, tg_username = ?, tg_name = ? WHERE token_hash = ? AND state IN ('pending', 'asked')", args: [tg.id, tg.username, tg.name, hash] });
    const link = m[1] === "link";
    const age = Math.max(0, t - Number(row.created_at));
    await say(
      chat,
      `${link ? "Привязать этот Telegram к вашему аккаунту Lidomap?" : "Войти на Lidomap с этим Telegram?"}\n\nЗапрос из браузера: ${uaLabel(String(row.ua))}\nIP: ${row.ip || "не определён"}\nЗапрошено ${age < 60 ? "только что" : `${Math.round(age / 60)} мин назад`}\n\nЕсли это не вы, нажмите «Нет».`,
      { reply_markup: { inline_keyboard: [[{ text: "✅ Да, это я", callback_data: `ok:${m[2]}` }, { text: "❌ Нет", callback_data: `no:${m[2]}` }]] } },
    ).catch(() => {});
    return;
  }

  const cb = u.callback_query;
  if (cb && typeof cb.id === "string" && typeof cb.data === "string") {
    const m = /^(ok|no):([A-Za-z0-9_-]{20,64})$/.exec(cb.data);
    const tg = toTg(cb.from ?? {});
    const answer = (text: string) => tgApi("answerCallbackQuery", { callback_query_id: cb.id, text }).catch(() => {});
    if (!m || !tg) return void (await answer("Запрос не распознан"));

    const hash = sha(m[2]);
    const next = m[1] === "ok" ? "confirmed" : "denied";
    // Подтвердить может только тот, кому бот задал вопрос.
    const upd = await db.execute({
      sql: "UPDATE tg_login_requests SET state = ?, tg_username = ?, tg_name = ? WHERE token_hash = ? AND state = 'asked' AND tg_id = ? AND expires_at > ?",
      args: [next, tg.username, tg.name, hash, tg.id, t],
    });
    if (upd.rowsAffected !== 1) return void (await answer("Запрос устарел. Запросите вход на сайте заново."));
    await answer(next === "confirmed" ? "Подтверждено" : "Отклонено");
    const chat = cb.message?.chat?.id, mid = cb.message?.message_id;
    if (typeof chat === "number" && typeof mid === "number") {
      await tgApi("editMessageText", {
        chat_id: chat, message_id: mid,
        text: next === "confirmed" ? "✅ Подтверждено. Вернитесь в браузер: страница обновится сама." : "❌ Отклонено. Если это были не вы, ничего делать не нужно.",
      }).catch(() => {});
    }
  }
}

export type PollResult =
  | { status: "waiting" | "expired" | "denied" | "needConsent" }
  | { status: "needConfirm"; info: MergeInfo }
  | { status: "done"; mode: LoginMode; userId: number; created: boolean; merged: boolean }
  | { status: "error"; error: string };

/**
 * Состояние запроса для браузера. Когда человек подтвердил вход в боте, здесь же выполняется сам вход или привязка:
 * по правилам: согласия для нового аккаунта, подтверждение объединения для привязки.
 * userId: кто сейчас вошёл в браузере (нужно только для привязки).
 */
export async function pollLoginRequest(
  token: string,
  opts: { userId?: number | null; refCode?: string | null; accept?: boolean; consent?: boolean; confirm?: boolean; canCreate?: () => Promise<boolean> } = {},
): Promise<PollResult> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { status: "expired" };
  const db = await appDb();
  const hash = sha(token);
  const row = (await db.execute({ sql: "SELECT * FROM tg_login_requests WHERE token_hash = ?", args: [hash] })).rows[0];
  if (!row || Number(row.expires_at) <= now() || String(row.state) === "consumed") return { status: "expired" };
  const state = String(row.state);
  if (state === "denied") return { status: "denied" };
  if (state !== "confirmed") return { status: "waiting" };

  const tg: TgUser = { id: Number(row.tg_id), name: row.tg_name == null ? null : String(row.tg_name), username: row.tg_username == null ? null : String(row.tg_username) };
  const consume = () => db.execute({ sql: "UPDATE tg_login_requests SET state = 'consumed' WHERE token_hash = ? AND state = 'confirmed'", args: [hash] });
  const mode = String(row.mode) as LoginMode;

  if (mode === "login") {
    const r = await loginOrCreateTelegramUser(tg, {
      refCode: opts.refCode, consentVersion: opts.accept === true && opts.consent === true ? LEGAL_VERSION : null, canCreate: opts.canCreate,
    });
    if (r.ok) {
      await consume();
      return { status: "done", mode, userId: r.userId, created: r.created, merged: false };
    }
    return r.needConsent ? { status: "needConsent" } : { status: "error", error: r.error };
  }

  const me = Number(row.user_id);
  if (!opts.userId || opts.userId !== me) return { status: "error", error: "Войдите в тот же аккаунт, из которого запрашивали привязку" };
  const r = await linkTelegram(me, tg, { confirm: opts.confirm === true });
  if (r.ok) {
    await consume();
    return { status: "done", mode, userId: me, created: false, merged: r.merged };
  }
  if (r.reason === "needConfirm") return { status: "needConfirm", info: r.info };
  return { status: "error", error: linkMessage(r.reason) };
}

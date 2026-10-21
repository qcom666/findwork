import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";

import { linkTelegram } from "../src/lib/account-link";
import { __resetAppDbForTests } from "../src/lib/db";
import { __resetWebhookCheck, botLink, checkWebhookSecret, ensureWebhook, tgApi, webhookSecret } from "../src/lib/telegram-bot";
import { createLoginRequest, handleBotUpdate, pollLoginRequest, uaLabel } from "../src/lib/tg-login";
import { createUser, loginOrCreateTelegramUser } from "../src/lib/users";

type Call = { method: string; body: Record<string, unknown> };
let server: http.Server;
let calls: Call[] = [];
let db: Awaited<ReturnType<typeof __resetAppDbForTests>>;
let failApi = false;

const ENV = { TELEGRAM_BOT_TOKEN: "777:BOT-TOKEN-FOR-TESTS", TELEGRAM_BOT_USERNAME: "fw_test_bot" };
const saved: Record<string, string | undefined> = {};

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const method = (req.url ?? "").split("/").pop() ?? "";
      calls.push({ method, body: raw ? JSON.parse(raw) : {} });
      res.writeHead(failApi ? 500 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(failApi ? { ok: false, description: "boom" } : { ok: true, result: method === "getMe" ? { id: 777, username: "fw_test_bot" } : true }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  for (const k of [...Object.keys(ENV), "TELEGRAM_API_URL"]) saved[k] = process.env[k];
  Object.assign(process.env, ENV, { TELEGRAM_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
});
after(() => {
  server.close();
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
beforeEach(async () => {
  calls = []; failApi = false;
  const dir = mkdtempSync(path.join(tmpdir(), "fw-tgbot-"));
  db = await __resetAppDbForTests("file:" + path.join(dir, "app.db"));
});

const anna: { id: number; first_name: string; last_name?: string; username: string } = { id: 4242, first_name: "Анна", last_name: "Петрова", username: "anna_p" };
const start = (token: string, mode = "login", from = anna) => ({ message: { chat: { id: from.id, type: "private" }, from, text: `/start ${mode}_${token}` } });
const press = (data: string, from = anna) => ({ callback_query: { id: "cb1", from, data, message: { chat: { id: from.id }, message_id: 9 } } });
const sent = (method: string) => calls.filter((c) => c.method === method);
const stateOf = async (token: string) => {
  const { createHash } = await import("node:crypto");
  return String((await db.execute({ sql: "SELECT state FROM tg_login_requests WHERE token_hash = ?", args: [createHash("sha256").update(token).digest("hex")] })).rows[0]?.state);
};

describe("Bot API и вебхук", () => {
  it("секрет вебхука выводится из токена и сверяется целиком", () => {
    const s = webhookSecret();
    assert.match(s, /^[0-9a-f]{48}$/);
    assert.equal(checkWebhookSecret(s), true);
    assert.equal(checkWebhookSecret(s.slice(0, -1) + "0"), false);
    assert.equal(checkWebhookSecret(""), false);
    assert.equal(checkWebhookSecret(null), false);
    process.env.TELEGRAM_BOT_TOKEN = "888:OTHER";
    assert.equal(checkWebhookSecret(s), false, "с другим токеном секрет другой");
    process.env.TELEGRAM_BOT_TOKEN = ENV.TELEGRAM_BOT_TOKEN;
  });

  it("запросы идут на сервер Telegram с токеном в адресе, ошибки пробрасываются", async () => {
    assert.deepEqual(await tgApi("getMe"), { id: 777, username: "fw_test_bot" });
    failApi = true;
    await assert.rejects(tgApi("getMe"), /boom/);
    assert.equal(botLink("login_abc"), "https://t.me/fw_test_bot?start=login_abc");
  });

  it("вебхук подключается сам один раз, повторные проверки кэшируются, при отказе Telegram бросает ошибку", async () => {
    __resetWebhookCheck();
    await ensureWebhook("https://findwork.example/");
    assert.deepEqual(calls.map((c) => c.method), ["getWebhookInfo", "setWebhook"]);
    const hook = calls[1].body;
    assert.equal(hook.url, "https://findwork.example/api/telegram/webhook");
    assert.equal(hook.secret_token, webhookSecret());
    assert.deepEqual(hook.allowed_updates, ["message", "callback_query"]);

    calls = [];
    await ensureWebhook("https://findwork.example");
    assert.equal(calls.length, 0, "в пределах пяти минут Telegram не опрашиваем");

    __resetWebhookCheck();
    failApi = true;
    await assert.rejects(ensureWebhook("https://findwork.example"), /boom/);
    __resetWebhookCheck();
  });

  it("браузер и система в вопросе боту", () => {
    assert.equal(uaLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17 Safari/605.1.15"), "Safari, iOS");
    assert.equal(uaLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36 Edg/120"), "Edge, Windows");
    assert.equal(uaLabel(""), "неизвестный браузер");
  });
});

describe("вход через бота", () => {
  it("полный путь: ссылка, Start, подтверждение, вход с согласиями", async () => {
    const r = await createLoginRequest({ mode: "login", ip: "1.2.3.4", ua: "Safari iPhone" });
    assert.match(r.token, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(r.url, `https://t.me/fw_test_bot?start=login_${r.token}`);
    assert.deepEqual(await pollLoginRequest(r.token), { status: "waiting" });
    // В базе только хеш секрета.
    const row = (await db.execute("SELECT token_hash FROM tg_login_requests")).rows[0];
    assert.ok(!String(row.token_hash).includes(r.token));

    await handleBotUpdate(start(r.token));
    const ask = sent("sendMessage")[0];
    assert.equal(ask.body.chat_id, anna.id);
    assert.match(String(ask.body.text), /IP: 1\.2\.3\.4/);
    const kb = (ask.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard[0];
    assert.deepEqual(kb.map((b) => b.callback_data), [`ok:${r.token}`, `no:${r.token}`]);
    assert.equal(await stateOf(r.token), "asked");
    assert.deepEqual(await pollLoginRequest(r.token), { status: "waiting" });

    await handleBotUpdate(press(`ok:${r.token}`));
    assert.equal(await stateOf(r.token), "confirmed");
    assert.equal(sent("answerCallbackQuery").length, 1);
    assert.equal(sent("editMessageText").length, 1);

    assert.deepEqual(await pollLoginRequest(r.token), { status: "needConsent" });
    assert.equal(Number((await db.execute("SELECT count(*) AS n FROM users")).rows[0].n), 0, "без согласий аккаунта нет");
    const done = await pollLoginRequest(r.token, { accept: true, consent: true });
    assert.ok(done.status === "done" && done.created);
    const u = (await db.execute({ sql: "SELECT tg_id, tg_username, display_name, consent_ver FROM users" })).rows[0];
    assert.deepEqual([u.tg_id, u.tg_username, u.display_name], [anna.id, "anna_p", "Анна Петрова"]);
    assert.ok(u.consent_ver);

    assert.deepEqual(await pollLoginRequest(r.token), { status: "expired" }, "одноразовая: повторно не работает");
  });

  it("существующий Telegram-аккаунт входит без согласий", async () => {
    const first = await loginOrCreateTelegramUser({ id: anna.id, name: "Анна", username: "anna_p" }, { consentVersion: "1" });
    assert.ok(first.ok);
    const r = await createLoginRequest({ mode: "login", ip: "1.1.1.1", ua: "" });
    await handleBotUpdate(start(r.token));
    await handleBotUpdate(press(`ok:${r.token}`));
    const done = await pollLoginRequest(r.token);
    assert.ok(done.status === "done" && !done.created && done.userId === first.userId);
  });

  it("«Нет» отклоняет вход", async () => {
    const r = await createLoginRequest({ mode: "login", ip: "", ua: "" });
    await handleBotUpdate(start(r.token));
    await handleBotUpdate(press(`no:${r.token}`));
    assert.deepEqual(await pollLoginRequest(r.token), { status: "denied" });
  });

  it("подтвердить может только тот, кому бот задал вопрос", async () => {
    const r = await createLoginRequest({ mode: "login", ip: "", ua: "" });
    await handleBotUpdate(start(r.token));
    const stranger = { id: 999, first_name: "Чужой", username: "stranger" };
    await handleBotUpdate(press(`ok:${r.token}`, stranger));
    assert.equal(await stateOf(r.token), "asked");
    // Другой человек тоже не может перехватить запрос, нажав Start по этой же ссылке.
    calls = [];
    await handleBotUpdate(start(r.token, "login", stranger));
    assert.match(String(sent("sendMessage")[0].body.text), /устарела или уже использована/);
    assert.equal(await stateOf(r.token), "asked");
  });

  it("устаревшая, чужая и выдуманная ссылки не работают", async () => {
    const r = await createLoginRequest({ mode: "login", ip: "", ua: "" });
    await db.execute("UPDATE tg_login_requests SET expires_at = 1");
    await handleBotUpdate(start(r.token));
    assert.match(String(sent("sendMessage")[0].body.text), /устарела/);
    assert.deepEqual(await pollLoginRequest(r.token), { status: "expired" });
    assert.deepEqual(await pollLoginRequest("A".repeat(32)), { status: "expired" });
    assert.deepEqual(await pollLoginRequest("short"), { status: "expired" });

    const fresh = await createLoginRequest({ mode: "login", ip: "", ua: "" });
    calls = [];
    await handleBotUpdate(start(fresh.token, "link"));
    assert.match(String(sent("sendMessage")[0].body.text), /устарела/, "ссылка входа не годится для привязки");
    await handleBotUpdate(press(`ok:${fresh.token}`));
    assert.equal(await stateOf(fresh.token), "pending", "без Start подтвердить нельзя");
  });

  it("другие сообщения и группы получают подсказку или игнорируются", async () => {
    await handleBotUpdate({ message: { chat: { id: 1, type: "private" }, from: anna, text: "привет" } });
    assert.match(String(sent("sendMessage")[0].body.text), /бот входа на Lidomap/);
    calls = [];
    await handleBotUpdate({ message: { chat: { id: 1, type: "group" }, from: anna, text: "/start login_" + "a".repeat(30) } });
    await handleBotUpdate({ message: { chat: { id: 2, type: "private" }, from: { id: 5, is_bot: true }, text: "/start" } });
    await handleBotUpdate(null);
    await handleBotUpdate({ callback_query: { id: "x", data: "ok:не-токен" } });
    assert.equal(sent("sendMessage").length, 1, "боту-отправителю подсказка уйдёт, группе и пустому нет");
  });

  it("сбой Telegram при ответе не ломает обработку", async () => {
    const r = await createLoginRequest({ mode: "login", ip: "", ua: "" });
    failApi = true;
    await handleBotUpdate(start(r.token));
    assert.equal(await stateOf(r.token), "asked");
  });

  it("лимит на создание аккаунтов срабатывает только когда аккаунт создаётся", async () => {
    const r = await createLoginRequest({ mode: "login", ip: "", ua: "" });
    await handleBotUpdate(start(r.token));
    await handleBotUpdate(press(`ok:${r.token}`));
    let asked = 0;
    const deny = async () => { asked++; return false; };
    assert.deepEqual(await pollLoginRequest(r.token, { canCreate: deny }), { status: "needConsent" });
    assert.equal(asked, 0);
    const res = await pollLoginRequest(r.token, { accept: true, consent: true, canCreate: deny });
    assert.equal(res.status, "error");
    assert.equal(asked, 1);
  });
});

describe("привязка через бота", () => {
  it("привязывает Telegram к аккаунту с почтой только из той же сессии", async () => {
    const me = await createUser("me@test.ru", "hash");
    assert.ok(me.ok);
    const r = await createLoginRequest({ mode: "link", userId: me.userId, ip: "", ua: "" });
    await handleBotUpdate(start(r.token, "link"));
    assert.match(String(sent("sendMessage")[0].body.text), /Привязать этот Telegram/);
    await handleBotUpdate(press(`ok:${r.token}`));

    const wrong = await pollLoginRequest(r.token, { userId: me.userId + 1 });
    assert.equal(wrong.status, "error");
    assert.equal((await pollLoginRequest(r.token, {})).status, "error", "без входа в аккаунт привязать нельзя");
    const done = await pollLoginRequest(r.token, { userId: me.userId });
    assert.deepEqual(done, { status: "done", mode: "link", userId: me.userId, created: false, merged: false });
    assert.equal(Number((await db.execute({ sql: "SELECT tg_id FROM users WHERE id = ?", args: [me.userId] })).rows[0].tg_id), anna.id);
  });

  it("если у Telegram есть отдельный аккаунт, сначала сводка, объединение после подтверждения", async () => {
    const me = await createUser("me@test.ru", "hash");
    assert.ok(me.ok);
    const solo = await loginOrCreateTelegramUser({ id: anna.id, name: "Анна", username: "anna_p" }, { consentVersion: "1" });
    assert.ok(solo.ok);
    const r = await createLoginRequest({ mode: "link", userId: me.userId, ip: "", ua: "" });
    await handleBotUpdate(start(r.token, "link"));
    await handleBotUpdate(press(`ok:${r.token}`));

    const need = await pollLoginRequest(r.token, { userId: me.userId });
    assert.equal(need.status, "needConfirm");
    assert.equal(await stateOf(r.token), "confirmed", "запрос не потрачен, можно подтвердить");
    const done = await pollLoginRequest(r.token, { userId: me.userId, confirm: true });
    assert.ok(done.status === "done" && done.merged);
    assert.equal((await db.execute({ sql: "SELECT 1 FROM users WHERE id = ?", args: [solo.userId] })).rows.length, 0);
    void linkTelegram;
  });
});

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { adjustCreditsByEmail, searchUsers } from "../src/lib/admin";
import { userLabel, validateCredentials } from "../src/lib/auth";
import { SIGNUP_BONUS, getBalance, getLedger } from "../src/lib/credits";
import { __resetAppDbForTests } from "../src/lib/db";
import { LEGAL_VERSION } from "../src/lib/legal";
import { verifyPassword } from "../src/lib/password";
import { requestPasswordReset } from "../src/lib/reset";
import { isTgEmail, telegramBotUsername, telegramConfigured, tgEmail, verifyTelegramLogin } from "../src/lib/telegram";
import { createUser, loginOrCreateTelegramUser } from "../src/lib/users";

const TOKEN = "123456:TEST-token-not-a-real-bot";
const NOW = 1_800_000_000;

/** Данные виджета, подписанные так же, как это делает Telegram. */
function widget(fields: Record<string, string | number>, token = TOKEN): Record<string, string | number> {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const hash = createHmac("sha256", createHash("sha256").update(token).digest()).update(check).digest("hex");
  return { ...fields, hash };
}
const base = { id: 777000111, first_name: "Анна", last_name: "Петрова", username: "anna_p", photo_url: "https://t.me/i/userpic/1.jpg", auth_date: NOW - 30 };

type Db = Awaited<ReturnType<typeof __resetAppDbForTests>>;
let db: Db;
beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fw-tg-"));
  db = await __resetAppDbForTests("file:" + path.join(dir, "app.db"));
});

describe("проверка подписи Telegram", () => {
  const verify = (d: unknown, nowSec = NOW) => verifyTelegramLogin(d, { token: TOKEN, nowSec });

  it("принимает правильно подписанные данные", () => {
    const r = verify(widget(base));
    assert.ok(r.ok);
    assert.deepEqual(r.user, { id: 777000111, name: "Анна Петрова", username: "anna_p" });
  });

  it("работает без фамилии и username", () => {
    const r = verify(widget({ id: 5, first_name: "Иван", auth_date: NOW }));
    assert.ok(r.ok);
    assert.deepEqual(r.user, { id: 5, name: "Иван", username: null });
  });

  it("подписывает все присланные поля, в том числе новые", () => {
    assert.ok(verify(widget({ ...base, some_new_field: "x" })).ok);
  });

  it("подмена любого поля ломает подпись", () => {
    for (const [k, v] of [["id", 1], ["first_name", "Вася"], ["username", "root"], ["auth_date", NOW - 10]] as const) {
      const r = verify({ ...widget(base), [k]: v });
      assert.deepEqual(r, { ok: false, reason: "signature" }, `поле ${k}`);
    }
  });

  it("чужой токен бота не проходит", () => {
    assert.deepEqual(verify(widget(base, "999:other-token")), { ok: false, reason: "signature" });
  });

  it("лишнее поле без подписи не проходит", () => {
    assert.deepEqual(verify({ ...widget(base), admin: "1" }), { ok: false, reason: "signature" });
  });

  it("старые данные отвергаются, свежие и чуть из будущего принимаются", () => {
    assert.deepEqual(verify(widget({ ...base, auth_date: NOW - 601 })), { ok: false, reason: "expired" });
    assert.ok(verify(widget({ ...base, auth_date: NOW - 590 })).ok);
    assert.ok(verify(widget({ ...base, auth_date: NOW + 200 })).ok, "часы могут расходиться");
    assert.deepEqual(verify(widget({ ...base, auth_date: NOW + 4000 })), { ok: false, reason: "expired" });
  });

  it("мусор вместо данных отвергается без ошибок", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { id: 1 }, { ...widget(base), hash: "zz" }, { ...widget(base), id: { a: 1 } }]) {
      const r = verify(bad);
      assert.equal(r.ok, false);
    }
    assert.equal(verifyTelegramLogin(widget(base), { token: "", nowSec: NOW }).ok, false, "без токена бота входить нельзя");
  });

  it("нечисловой или отрицательный id отвергается даже при верной подписи", () => {
    assert.equal(verify(widget({ ...base, id: "abc" })).ok, false);
    assert.equal(verify(widget({ ...base, id: -5 })).ok, false);
  });

  it("username с лишними символами не сохраняется", () => {
    const r = verify(widget({ ...base, username: "<script>" }));
    assert.ok(r.ok);
    assert.equal(r.user.username, null);
  });
});

describe("настройка бота", () => {
  it("включается только когда заданы и имя бота, и токен", () => {
    const keep = { u: process.env.TELEGRAM_BOT_USERNAME, t: process.env.TELEGRAM_BOT_TOKEN };
    try {
      delete process.env.TELEGRAM_BOT_USERNAME; delete process.env.TELEGRAM_BOT_TOKEN;
      assert.equal(telegramConfigured(), false);
      process.env.TELEGRAM_BOT_USERNAME = "@findwork_bot";
      assert.equal(telegramBotUsername(), "findwork_bot", "@ в начале отбрасывается");
      assert.equal(telegramConfigured(), false, "токена нет");
      process.env.TELEGRAM_BOT_TOKEN = TOKEN;
      assert.equal(telegramConfigured(), true);
      process.env.TELEGRAM_BOT_USERNAME = "bad name!";
      assert.equal(telegramConfigured(), false, "имя с мусором не принимается");
    } finally {
      for (const [k, v] of [["TELEGRAM_BOT_USERNAME", keep.u], ["TELEGRAM_BOT_TOKEN", keep.t]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});

describe("вход и регистрация через Telegram", () => {
  const tg = { id: 777000111, name: "Анна Петрова", username: "anna_p" };

  it("новому человеку без согласия аккаунт не создаётся", async () => {
    const r = await loginOrCreateTelegramUser(tg);
    assert.deepEqual(r, { ok: false, needConsent: true });
    assert.equal(Number((await db.execute("SELECT count(*) AS n FROM users")).rows[0].n), 0);
  });

  it("с согласием создаёт аккаунт: бонус, запись о согласии, служебная почта, пароля нет", async () => {
    const r = await loginOrCreateTelegramUser(tg, { consentVersion: LEGAL_VERSION });
    assert.ok(r.ok && r.created);
    const u = (await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [r.userId] })).rows[0];
    assert.equal(u.email, tgEmail(tg.id));
    assert.equal(u.tg_id, tg.id);
    assert.equal(u.tg_username, "anna_p");
    assert.equal(u.display_name, "Анна Петрова");
    assert.equal(u.consent_ver, LEGAL_VERSION);
    assert.ok(Number(u.consent_at) > 0);
    assert.equal(await getBalance(r.userId), SIGNUP_BONUS);
    if (SIGNUP_BONUS > 0) assert.equal((await getLedger(r.userId))[0].reason, "signup_bonus");
    assert.equal(await verifyPassword("", String(u.pass_hash)), false);
    assert.equal(await verifyPassword("anything", String(u.pass_hash)), false);
  });

  it("повторный вход находит тот же аккаунт, согласие не нужно, имя обновляется", async () => {
    const first = await loginOrCreateTelegramUser(tg, { consentVersion: LEGAL_VERSION });
    assert.ok(first.ok);
    const again = await loginOrCreateTelegramUser({ ...tg, username: "anna_new", name: "Анна П." });
    assert.deepEqual(again, { ok: true, userId: first.userId, created: false });
    const u = (await db.execute({ sql: "SELECT tg_username, display_name FROM users WHERE id = ?", args: [first.userId] })).rows[0];
    assert.equal(u.tg_username, "anna_new");
    assert.equal(u.display_name, "Анна П.");
    assert.equal(await getBalance(first.userId), SIGNUP_BONUS, "бонус не начисляется второй раз");
  });

  it("одновременные первые входы создают один аккаунт", async () => {
    const res = await Promise.all(Array.from({ length: 5 }, () => loginOrCreateTelegramUser(tg, { consentVersion: LEGAL_VERSION })));
    assert.ok(res.every((r) => r.ok));
    assert.equal(new Set(res.map((r) => (r.ok ? r.userId : 0))).size, 1);
    assert.equal(res.filter((r) => r.ok && r.created).length, 1);
    assert.equal(Number((await db.execute("SELECT count(*) AS n FROM users")).rows[0].n), 1);
  });

  it("лимит на создание проверяется только когда аккаунт правда создаётся", async () => {
    let asked = 0;
    const deny = async () => { asked++; return false; };
    assert.equal((await loginOrCreateTelegramUser(tg, { canCreate: deny })).ok, false);
    assert.equal(asked, 0, "без согласия лимит не тратится");
    const blocked = await loginOrCreateTelegramUser(tg, { consentVersion: LEGAL_VERSION, canCreate: deny });
    assert.equal(blocked.ok, false);
    assert.equal(asked, 1);
    assert.equal(Number((await db.execute("SELECT count(*) AS n FROM users")).rows[0].n), 0);

    const ok = await loginOrCreateTelegramUser(tg, { consentVersion: LEGAL_VERSION });
    assert.ok(ok.ok);
    await loginOrCreateTelegramUser(tg, { canCreate: deny });
    assert.equal(asked, 1, "существующему аккаунту лимит на создание не мешает");
  });

  it("реферальный код пригласившего работает и для Telegram", async () => {
    const inviter = await createUser("inviter@test.ru", "x");
    assert.ok(inviter.ok);
    const code = String((await db.execute({ sql: "SELECT ref_code FROM users WHERE id = ?", args: [inviter.userId] })).rows[0].ref_code);
    const r = await loginOrCreateTelegramUser(tg, { consentVersion: LEGAL_VERSION, refCode: code });
    assert.ok(r.ok);
    const by = (await db.execute({ sql: "SELECT referred_by FROM users WHERE id = ?", args: [r.userId] })).rows[0].referred_by;
    assert.equal(Number(by), inviter.userId);
  });
});

describe("служебная почта аккаунтов Telegram", () => {
  it("занять её вручную при регистрации нельзя", () => {
    assert.equal(validateCredentials(tgEmail(5), "longenough1"), "Проверьте e-mail");
    assert.equal(validateCredentials("someone@example.invalid", "longenough1"), "Проверьте e-mail");
    assert.equal(validateCredentials("someone@example.com", "longenough1"), null);
    assert.equal(isTgEmail(tgEmail(5)), true);
    assert.equal(isTgEmail("a@b.ru"), false);
  });

  it("человек показывается по @username, затем по имени, у почтовых аккаунтов по почте", () => {
    assert.equal(userLabel(tgEmail(1), "anna_p", "Анна"), "@anna_p");
    assert.equal(userLabel(tgEmail(1), null, "Анна"), "Анна");
    assert.equal(userLabel(tgEmail(1), null, null), "Telegram");
    assert.equal(userLabel("a@b.ru", "x", "Y"), "a@b.ru");
  });

  it("сброс пароля на служебную почту ничего не отправляет", async () => {
    const keep = { k: process.env.RESEND_API_KEY, f: process.env.EMAIL_FROM, u: process.env.RESEND_API_URL };
    process.env.RESEND_API_KEY = "k"; process.env.EMAIL_FROM = "x@y.ru"; process.env.RESEND_API_URL = "http://127.0.0.1:1/never";
    try {
      await loginOrCreateTelegramUser({ id: 42, name: "A", username: null }, { consentVersion: LEGAL_VERSION });
      assert.deepEqual(await requestPasswordReset(tgEmail(42), "https://x"), { configured: true });
    } finally {
      for (const [k, v] of [["RESEND_API_KEY", keep.k], ["EMAIL_FROM", keep.f], ["RESEND_API_URL", keep.u]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});

describe("админка и аккаунты Telegram", () => {
  it("кредиты можно начислить по @username, регистр не важен", async () => {
    const r = await loginOrCreateTelegramUser({ id: 9, name: "Анна", username: "Anna_P" }, { consentVersion: LEGAL_VERSION });
    assert.ok(r.ok);
    const out = await adjustCreditsByEmail("@anna_p", 7, "подарок");
    assert.deepEqual(out, { ok: true, balance: SIGNUP_BONUS + 7, email: "@anna_p" });
    const miss = await adjustCreditsByEmail("@nobody", 1, "");
    assert.equal(miss.ok, false);
  });

  it("поиск находит по username и имени, показывает метку", async () => {
    await loginOrCreateTelegramUser({ id: 9, name: "Анна Петрова", username: "anna_p" }, { consentVersion: LEGAL_VERSION });
    await createUser("mail@test.ru", "x");
    for (const q of ["anna_p", "@ANNA", "петрова"]) {
      const found = await searchUsers(q);
      assert.equal(found.length, 1, q);
      assert.equal(found[0].label, "@anna_p");
    }
    assert.equal((await searchUsers("mail@")).length, 1);
    assert.equal((await searchUsers("")).length, 2);
  });
});

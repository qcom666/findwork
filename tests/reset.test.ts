import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";

import { appDb, __resetAppDbForTests } from "../src/lib/db";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { requestPasswordReset, resetPassword } from "../src/lib/reset";

let server: http.Server;
let sent: { headers: http.IncomingHttpHeaders; body: { from: string; to: string[]; subject: string; text: string; html?: string } }[] = [];
let failNext = false;

const MAIL = "owner@t.ru";
const BASE = "https://findwork.example";

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (failNext) { failNext = false; res.writeHead(500); res.end("boom"); return; }
      sent.push({ headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "email-1" }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  process.env.RESEND_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/emails`;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "FindWork <noreply@findwork.example>";
});
after(() => {
  server.close();
  for (const k of ["RESEND_API_URL", "RESEND_API_KEY", "EMAIL_FROM"]) delete process.env[k];
});

beforeEach(async () => {
  sent = [];
  failNext = false;
  await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-reset-")), "app.db"));
  const db = await appDb();
  await db.execute({ sql: "INSERT INTO users(email, pass_hash, balance, created_at) VALUES (?, ?, 5, 0)", args: [MAIL, await hashPassword("old-password-1")] });
  await db.execute("INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES ('s1', 1, 9999999999, 0), ('s2', 1, 9999999999, 0)");
});

const tokenFrom = (text: string) => text.match(/reset\?token=([A-Za-z0-9_-]+)/)![1];

describe("сброс пароля", () => {
  it("без настроенной почты ничего не отправляет и сообщает об этом", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await requestPasswordReset(MAIL, BASE);
    process.env.RESEND_API_KEY = "re_test_key";
    assert.deepEqual(r, { configured: false });
    assert.equal(sent.length, 0);
  });

  it("неизвестный адрес: письма нет, токена нет, ответ такой же, как у известного", async () => {
    const r = await requestPasswordReset("nobody@t.ru", BASE);
    assert.deepEqual(r, { configured: true });
    assert.equal(sent.length, 0);
    assert.equal(Number((await (await appDb()).execute("SELECT count(*) AS n FROM password_resets")).rows[0].n), 0);
  });

  it("известный адрес: одно письмо по документации Resend, ссылка с токеном, в базе только хэш", async () => {
    await requestPasswordReset("  Owner@T.ru ", BASE);
    assert.equal(sent.length, 1);
    const m = sent[0];
    assert.equal(m.headers.authorization, "Bearer re_test_key");
    assert.deepEqual(m.body.to, [MAIL]);
    assert.equal(m.body.from, "FindWork <noreply@findwork.example>");
    assert.match(m.body.subject, /Сброс пароля/);
    assert.match(m.body.text, /https:\/\/findwork\.example\/reset\?token=/);
    const token = tokenFrom(m.body.text);
    const rows = (await (await appDb()).execute("SELECT token_hash FROM password_resets")).rows;
    assert.equal(rows.length, 1);
    assert.notEqual(String(rows[0].token_hash), token, "токен не хранится открытым текстом");
  });

  it("новая ссылка гасит прежнюю", async () => {
    await requestPasswordReset(MAIL, BASE);
    await requestPasswordReset(MAIL, BASE);
    const [first, second] = sent.map((m) => tokenFrom(m.body.text));
    assert.equal((await resetPassword(first, "brand-new-pass-1")).ok, false);
    assert.equal((await resetPassword(second, "brand-new-pass-1")).ok, true);
  });

  it("смена пароля: новый работает, старый нет, ссылка одноразовая, прежние входы закрыты", async () => {
    await requestPasswordReset(MAIL, BASE);
    const token = tokenFrom(sent[0].body.text);
    const r = await resetPassword(token, "brand-new-pass-1");
    assert.deepEqual(r, { ok: true, userId: 1 });

    const db = await appDb();
    const hash = String((await db.execute("SELECT pass_hash FROM users WHERE id = 1")).rows[0].pass_hash);
    assert.equal(await verifyPassword("brand-new-pass-1", hash), true);
    assert.equal(await verifyPassword("old-password-1", hash), false);
    assert.equal(Number((await db.execute("SELECT count(*) AS n FROM sessions WHERE user_id = 1")).rows[0].n), 0);

    assert.equal((await resetPassword(token, "another-pass-22")).ok, false, "повторно по той же ссылке нельзя");
  });

  it("слишком короткий пароль отклоняется и не сжигает ссылку", async () => {
    await requestPasswordReset(MAIL, BASE);
    const token = tokenFrom(sent[0].body.text);
    const bad = await resetPassword(token, "short");
    assert.equal(bad.ok, false);
    assert.equal((await resetPassword(token, "long-enough-pass")).ok, true);
  });

  it("просроченная и выдуманная ссылки не работают", async () => {
    await requestPasswordReset(MAIL, BASE);
    const token = tokenFrom(sent[0].body.text);
    await (await appDb()).execute("UPDATE password_resets SET expires_at = 1");
    assert.equal((await resetPassword(token, "long-enough-pass")).ok, false);
    assert.equal((await resetPassword("не-токен", "long-enough-pass")).ok, false);
  });

  it("ошибка почтового сервиса пробрасывается, чтобы маршрут ответил ошибкой", async () => {
    failNext = true;
    await assert.rejects(requestPasswordReset(MAIL, BASE));
  });
});

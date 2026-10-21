import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { banUser, searchUsers, unbanUser, zeroCredits } from "../src/lib/admin";
import { createSubscriptionCheckout, fulfillPayment } from "../src/lib/billing";
import { claimLead } from "../src/lib/claims";
import { getBalance, getLedger, unlockLead } from "../src/lib/credits";
import { __resetAppDbForTests } from "../src/lib/db";
import { getMetrics } from "../src/lib/metrics";
import { getPlan } from "../src/lib/plans";
import { cleanProfile, createReport, getPublicReport } from "../src/lib/reports";
import { createUser, loginOrCreateTelegramUser } from "../src/lib/users";

type Db = Awaited<ReturnType<typeof __resetAppDbForTests>>;
let db: Db;
const keepAdmins = process.env.ADMIN_EMAILS;

async function user(email: string, balance = 0): Promise<number> {
  const r = await createUser(email, "hash");
  assert.ok(r.ok);
  await db.execute({ sql: "UPDATE users SET balance = ? WHERE id = ?", args: [balance, r.userId] });
  return r.userId;
}
const count = async (sql: string, ...args: number[]) => Number((await db.execute({ sql, args })).rows[0].n);

beforeEach(async () => {
  db = await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-mod-")), "app.db"));
  process.env.ADMIN_EMAILS = "owner@test.ru";
});
afterEach(() => {
  if (keepAdmins === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = keepAdmins;
});

describe("забрать кредиты", () => {
  it("обнуляет баланс одной проводкой и сохраняет историю", async () => {
    const u = await user("a@test.ru", 40);
    const r = await zeroCredits(u, "возврат оплаты");
    assert.deepEqual(r, { ok: true, balance: 0, taken: 40 });
    assert.equal(await getBalance(u), 0);
    const led = (await getLedger(u)).find((l) => l.reason === "admin");
    assert.deepEqual([led?.delta, led?.ref], [-40, "возврат оплаты"]);
  });

  it("при нулевом балансе ничего не пишет, неизвестный пользователь отвергается", async () => {
    const u = await user("a@test.ru", 0);
    assert.deepEqual(await zeroCredits(u, ""), { ok: true, balance: 0, taken: 0 });
    assert.equal((await getLedger(u)).filter((l) => l.reason === "admin").length, 0);
    assert.equal((await zeroCredits(99999, "")).ok, false);
  });
});

describe("блокировка", () => {
  it("закрывает сессии и ссылки сброса, освобождает эксклюзивы и гасит отчёты", async () => {
    const bad = await user("bad@test.ru", 100);
    const other = await user("other@test.ru", 10);
    await db.execute({ sql: "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES ('s1', ?, 9999999999, 0)", args: [bad] });
    await db.execute({ sql: "INSERT INTO password_resets(token_hash, user_id, expires_at, used, created_at) VALUES ('r1', ?, 9999999999, 0, 0)", args: [bad] });
    const { paymentId } = await createSubscriptionCheckout({ id: bad, email: "x@y.ru" }, getPlan("freelance")!, 1, "https://x");
    await fulfillPayment(paymentId);
    await unlockLead(bad, "HOT");
    assert.ok((await claimLead(bad, "HOT")).ok);
    const rep = await createReport(bad, { leadId: "HOT", leadName: "Лотос", siteUrl: "https://x.ru", findings: [], profile: cleanProfile({ name: "A", contact: "@a" }) });
    assert.ok(rep.ok);
    assert.equal((await unlockLead(other, "HOT")).ok, false, "пока эксклюзив жив, заведение закрыто");

    const before = await getBalance(bad);
    const r = await banUser(bad, "спам в отчётах", { zero: true });
    assert.deepEqual(r, { ok: true, balance: 0, taken: before });

    const row = (await db.execute({ sql: "SELECT banned_at, ban_reason FROM users WHERE id = ?", args: [bad] })).rows[0];
    assert.ok(Number(row.banned_at) > 0);
    assert.equal(row.ban_reason, "спам в отчётах");
    assert.equal(await count("SELECT count(*) AS n FROM sessions WHERE user_id = ?", bad), 0);
    assert.equal(await count("SELECT count(*) AS n FROM password_resets WHERE user_id = ? AND used = 0", bad), 0);
    assert.equal(await count("SELECT count(*) AS n FROM lead_claims WHERE user_id = ?", bad), 0);
    assert.ok((await unlockLead(other, "HOT")).ok, "эксклюзив освободился");
    assert.deepEqual(await getPublicReport(rep.ok ? rep.token : ""), { state: "revoked" });
  });

  it("без галочки кредиты остаются, повторная блокировка обновляет причину", async () => {
    const u = await user("a@test.ru", 25);
    assert.deepEqual(await banUser(u, "раз"), { ok: true, balance: 25, taken: 0 });
    assert.equal(await getBalance(u), 25);
    await banUser(u, "два");
    assert.equal(String((await db.execute({ sql: "SELECT ban_reason FROM users WHERE id = ?", args: [u] })).rows[0].ban_reason), "два");
  });

  it("владельца заблокировать нельзя, неизвестного тоже", async () => {
    const owner = await user("owner@test.ru", 5);
    assert.deepEqual(await banUser(owner, "случайно"), { ok: false, error: "Владельца заблокировать нельзя" });
    assert.equal(await count("SELECT count(*) AS n FROM users WHERE banned_at IS NOT NULL"), 0);
    assert.equal((await banUser(424242, "")).ok, false);
  });

  it("разблокировка снимает отметку, кредиты и отчёты сами не возвращаются", async () => {
    const u = await user("a@test.ru", 30);
    await banUser(u, "тест", { zero: true });
    assert.deepEqual(await unbanUser(u), { ok: true });
    assert.deepEqual(await unbanUser(u), { ok: false }, "уже разблокирован");
    assert.equal(await count("SELECT count(*) AS n FROM users WHERE id = ? AND banned_at IS NULL", u), 1);
    assert.equal(await getBalance(u), 0);
  });

  it("заблокированный не входит через Telegram, остальные входят", async () => {
    const tg = { id: 321, name: "Анна", username: "anna" };
    const created = await loginOrCreateTelegramUser(tg, { consentVersion: "1" });
    assert.ok(created.ok);
    await banUser(created.userId, "тест");
    const again = await loginOrCreateTelegramUser(tg);
    assert.ok(!again.ok && !again.needConsent && /заблокирован/.test(again.error));
    await unbanUser(created.userId);
    assert.ok((await loginOrCreateTelegramUser(tg)).ok);
  });

  it("в списке виден статус, фильтр показывает только заблокированных, владелец помечен", async () => {
    const bad = await user("bad@test.ru");
    await user("good@test.ru");
    await user("owner@test.ru");
    await banUser(bad, "причина");
    const all = await searchUsers("");
    const byEmail = Object.fromEntries(all.map((u) => [u.email, u]));
    assert.equal(byEmail["bad@test.ru"].banned, true);
    assert.equal(byEmail["bad@test.ru"].banReason, "причина");
    assert.equal(byEmail["good@test.ru"].banned, false);
    assert.equal(byEmail["owner@test.ru"].isAdmin, true);
    const only = await searchUsers("", 50, { onlyBanned: true });
    assert.deepEqual(only.map((u) => u.email), ["bad@test.ru"]);
    assert.deepEqual((await searchUsers("bad", 50, { onlyBanned: true })).map((u) => u.email), ["bad@test.ru"]);
    assert.deepEqual(await searchUsers("good", 50, { onlyBanned: true }), []);
  });
});

describe("учёт кредитов без владельца", () => {
  it("кредиты владельца не входят ни в «на балансах», ни в «продано»", async () => {
    const owner = await user("owner@test.ru", 5000);
    const a = await user("a@test.ru", 40);
    const b = await user("b@test.ru", 60);
    const pay = (id: string, uid: number, credits: number) =>
      db.execute({ sql: "INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at, paid_at, kind) VALUES (?, ?, 's100', ?, 49000, 'succeeded', 'yookassa', 1, 1, 'credits')", args: [id, uid, credits] });
    await pay("p-owner", owner, 1500);
    await pay("p-a", a, 100);
    await pay("p-b", b, 400);

    const m = await getMetrics();
    assert.equal(m.usage.creditsLeft, 100, "только 40 + 60");
    assert.equal(m.money.creditsSold, 500, "только 100 + 400");

    delete process.env.ADMIN_EMAILS;
    const all = await getMetrics();
    assert.equal(all.usage.creditsLeft, 5100, "без ADMIN_EMAILS считаются все");
    assert.equal(all.money.creditsSold, 2000);
  });
});

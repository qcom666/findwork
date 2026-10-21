import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { linkTelegram, unlinkTelegram } from "../src/lib/account-link";
import { createSubscriptionCheckout, fulfillPayment } from "../src/lib/billing";
import { claimLead } from "../src/lib/claims";
import { SIGNUP_BONUS, getBalance, getLedger, unlockLead } from "../src/lib/credits";
import { __resetAppDbForTests } from "../src/lib/db";
import { LEGAL_VERSION } from "../src/lib/legal";
import { redeemPromo } from "../src/lib/promo";
import { cleanProfile, createReport } from "../src/lib/reports";
import { getSubscriptions } from "../src/lib/subscriptions";
import { tgEmail } from "../src/lib/telegram";
import { createUser, loginOrCreateTelegramUser } from "../src/lib/users";
import { getPlan } from "../src/lib/plans";

type Db = Awaited<ReturnType<typeof __resetAppDbForTests>>;
let db: Db;
const tg = { id: 5550001, name: "Анна Петрова", username: "anna_p" as string | null };

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fw-link-"));
  db = await __resetAppDbForTests("file:" + path.join(dir, "app.db"));
});

async function emailUser(email: string, balance = 0): Promise<number> {
  const r = await createUser(email, "hash-of-a-real-password");
  assert.ok(r.ok);
  if (balance) await db.execute({ sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [balance, r.userId] });
  return r.userId;
}

async function tgUser(t = tg): Promise<number> {
  const r = await loginOrCreateTelegramUser(t, { consentVersion: LEGAL_VERSION });
  assert.ok(r.ok);
  return r.userId;
}

const rowsOf = async (table: string, userId: number) => Number((await db.execute({ sql: `SELECT count(*) AS n FROM ${table} WHERE user_id = ?`, args: [userId] })).rows[0].n);
const userExists = async (id: number) => (await db.execute({ sql: "SELECT 1 FROM users WHERE id = ?", args: [id] })).rows.length > 0;

describe("привязка Telegram к аккаунту с почтой", () => {
  it("свободный Telegram привязывается, и вход через него ведёт в тот же аккаунт без нового бонуса", async () => {
    const u = await emailUser("a@test.ru");
    assert.deepEqual(await linkTelegram(u, tg), { ok: true, merged: false });
    const row = (await db.execute({ sql: "SELECT tg_id, tg_username, display_name FROM users WHERE id = ?", args: [u] })).rows[0];
    assert.deepEqual([row.tg_id, row.tg_username, row.display_name], [tg.id, "anna_p", "Анна Петрова"]);

    const login = await loginOrCreateTelegramUser(tg);
    assert.deepEqual(login, { ok: true, userId: u, created: false });
    assert.equal(Number((await db.execute("SELECT count(*) AS n FROM users")).rows[0].n), 1, "второго аккаунта нет");
    assert.equal(await getBalance(u), SIGNUP_BONUS);
  });

  it("повтор, другой Telegram и аккаунт, созданный через Telegram, привязку не принимают", async () => {
    const u = await emailUser("a@test.ru");
    await linkTelegram(u, tg);
    assert.deepEqual(await linkTelegram(u, tg), { ok: false, reason: "already" });
    assert.deepEqual(await linkTelegram(u, { ...tg, id: 999 }), { ok: false, reason: "other_tg" });
    const onlyTg = await tgUser({ id: 777, name: "B", username: "c_user" });
    assert.deepEqual(await linkTelegram(onlyTg, { id: 888, name: "C", username: null }), { ok: false, reason: "synthetic" });
    assert.deepEqual(await linkTelegram(424242, tg), { ok: false, reason: "no_user" });
  });

  it("Telegram, привязанный к другому аккаунту с почтой, не отбирается и не вливается", async () => {
    const owner = await emailUser("owner@test.ru", 50);
    const thief = await emailUser("other@test.ru");
    await linkTelegram(owner, tg);
    assert.deepEqual(await linkTelegram(thief, tg), { ok: false, reason: "taken" });
    assert.ok(await userExists(owner));
    assert.equal(await getBalance(owner), SIGNUP_BONUS + 50);
  });

  it("если у Telegram уже есть отдельный аккаунт, без подтверждения ничего не меняется и приходит сводка", async () => {
    const mail = await emailUser("a@test.ru");
    const solo = await tgUser();
    await unlockLead(solo, "L1");
    const r = await linkTelegram(mail, tg);
    assert.ok(!r.ok && r.reason === "needConfirm");
    if (!r.ok && r.reason === "needConfirm") {
      assert.equal(r.info.balance, SIGNUP_BONUS - 1);
      assert.equal(r.info.unlocks, 1);
    }
    assert.ok(await userExists(solo), "аккаунт Telegram цел");
    assert.equal(await rowsOf("unlocks", solo), 1);
    const row = (await db.execute({ sql: "SELECT tg_id FROM users WHERE id = ?", args: [mail] })).rows[0];
    assert.equal(row.tg_id, null);
  });

  it("с подтверждением аккаунты объединяются: кредиты, история, заведения, платежи, подписки, эксклюзивы, отчёты", async () => {
    const mail = await emailUser("a@test.ru", 20);
    const solo = await tgUser();
    await db.execute({ sql: "UPDATE users SET balance = balance + 400 WHERE id = ?", args: [solo] });

    // Данные TG-аккаунта: открытые заведения (одно пересекается), заметка, питч, платёж, подписка, эксклюзив, отчёт, промокод.
    await unlockLead(mail, "SHARED");
    await unlockLead(solo, "SHARED"); await unlockLead(solo, "ONLY-TG");
    await db.execute({ sql: "INSERT INTO lead_notes(user_id, lead_id, status, note, updated_at) VALUES (?, 'ONLY-TG', 'sent', 'писал вчера', 1), (?, 'SHARED', 'new', 'заметка из Telegram', 1), (?, 'SHARED', 'won', 'заметка почты', 2)", args: [solo, solo, mail] });
    await db.execute({ sql: "INSERT INTO lead_pitches(user_id, lead_id, service, channel, subject, message, followup, angle, source, created_at) VALUES (?, 'ONLY-TG', 'site', 'telegram', '', 'текст', '', '', 'template', 1)", args: [solo] });
    await db.execute({ sql: "INSERT INTO promo_codes(code, credits, created_at) VALUES ('GIFT', 5, 0)" });
    await db.execute({ sql: "INSERT INTO promo_redemptions(user_id, code, created_at) VALUES (?, 'GIFT', 1)", args: [solo] });
    await db.execute({ sql: "INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at, kind) VALUES ('pend', ?, 's100', 100, 49000, 'pending', 'mock', 0, 'credits')", args: [solo] });
    const { paymentId } = await createSubscriptionCheckout({ id: solo, email: "x@y.ru" }, getPlan("freelance")!, 3, "https://x");
    await fulfillPayment(paymentId);
    await unlockLead(solo, "HOT");
    assert.ok((await claimLead(solo, "HOT")).ok);
    assert.ok((await createReport(solo, { leadId: "ONLY-TG", leadName: "Лотос", siteUrl: "https://x.ru", findings: [], profile: cleanProfile({ name: "A", contact: "@a" }) })).ok);

    const mailBefore = await getBalance(mail);
    const soloBefore = await getBalance(solo);
    const r = await linkTelegram(mail, tg, { confirm: true });
    assert.deepEqual(r, { ok: true, merged: true });

    assert.equal(await userExists(solo), false, "отдельного аккаунта нет");
    assert.equal(await getBalance(mail), mailBefore + soloBefore);
    assert.equal(await rowsOf("unlocks", mail), 3, "SHARED, ONLY-TG и HOT: пересечение не задвоилось");
    const notes = (await db.execute({ sql: "SELECT lead_id, note FROM lead_notes WHERE user_id = ? ORDER BY lead_id", args: [mail] })).rows.map((r) => [r.lead_id, r.note]);
    assert.deepEqual(notes, [["ONLY-TG", "писал вчера"], ["SHARED", "заметка почты"]], "при пересечении побеждает запись аккаунта с почтой");
    assert.equal(await rowsOf("lead_pitches", mail), 1);
    assert.equal(await rowsOf("payments", mail), 2);
    assert.equal(await rowsOf("lead_claims", mail), 1);
    assert.equal(await rowsOf("audit_reports", mail), 1);
    assert.equal((await getSubscriptions(mail)).length, 1);
    assert.ok((await getLedger(mail)).length >= 3, "история кредитов перенесена");
    assert.equal(await rowsOf("promo_redemptions", mail), 1);
    assert.equal((await redeemPromo(mail, "GIFT")).ok, false, "промокод из Telegram-аккаунта второй раз не применить");

    // Ожидавший платёж теперь зачислится объединённому аккаунту.
    await fulfillPayment("pend");
    assert.equal(await getBalance(mail), mailBefore + soloBefore + 100);

    const row = (await db.execute({ sql: "SELECT tg_id, tg_username FROM users WHERE id = ?", args: [mail] })).rows[0];
    assert.deepEqual([row.tg_id, row.tg_username], [tg.id, "anna_p"]);
    assert.deepEqual(await loginOrCreateTelegramUser(tg), { ok: true, userId: mail, created: false });
    const merge = (await db.execute("SELECT source_id, target_id, source_email, summary FROM account_merges")).rows[0];
    assert.deepEqual([Number(merge.source_id), Number(merge.target_id), merge.source_email], [solo, mail, tgEmail(tg.id)]);
    assert.equal(JSON.parse(String(merge.summary)).unlocks, 3);
  });

  it("приглашения и награды переходят к объединённому аккаунту", async () => {
    const mail = await emailUser("a@test.ru");
    const solo = await tgUser();
    const friend = await emailUser("friend@test.ru");
    await db.execute({ sql: "UPDATE users SET referred_by = ? WHERE id = ?", args: [solo, friend] });
    await db.execute({ sql: "INSERT INTO referral_rewards(referred_id, referrer_id, credits, created_at) VALUES (?, ?, 10, 1)", args: [friend, solo] });
    // Сам Telegram-аккаунт был приглашён, а аккаунт с почтой нет: награда за приглашение сохраняется.
    const boss = await emailUser("boss@test.ru");
    await db.execute({ sql: "UPDATE users SET referred_by = ? WHERE id = ?", args: [boss, solo] });
    await db.execute({ sql: "INSERT INTO referral_rewards(referred_id, referrer_id, credits, created_at) VALUES (?, ?, 10, 1)", args: [solo, boss] });

    assert.deepEqual(await linkTelegram(mail, tg, { confirm: true }), { ok: true, merged: true });
    assert.equal(Number((await db.execute({ sql: "SELECT referred_by FROM users WHERE id = ?", args: [friend] })).rows[0].referred_by), mail);
    assert.equal(Number((await db.execute({ sql: "SELECT referrer_id FROM referral_rewards WHERE referred_id = ?", args: [friend] })).rows[0].referrer_id), mail);
    assert.equal((await db.execute({ sql: "SELECT count(*) AS n FROM referral_rewards WHERE referred_id = ?", args: [mail] })).rows[0].n, 1);
  });

  it("два аккаунта с почтой одновременно пытаются забрать один Telegram: достаётся одному", async () => {
    const a = await emailUser("a@test.ru"), b = await emailUser("b@test.ru");
    const res = await Promise.all([linkTelegram(a, tg), linkTelegram(b, tg)]);
    assert.equal(res.filter((r) => r.ok).length, 1);
    assert.equal(Number((await db.execute({ sql: "SELECT count(*) AS n FROM users WHERE tg_id = ?", args: [tg.id] })).rows[0].n), 1);
  });
});

describe("отвязка Telegram", () => {
  it("аккаунт с почтой отвязывает Telegram, потом тот же Telegram создаёт отдельный аккаунт", async () => {
    const u = await emailUser("a@test.ru");
    await linkTelegram(u, tg);
    assert.deepEqual(await unlinkTelegram(u), { ok: true });
    const row = (await db.execute({ sql: "SELECT tg_id, tg_username FROM users WHERE id = ?", args: [u] })).rows[0];
    assert.deepEqual([row.tg_id, row.tg_username], [null, null]);
    assert.deepEqual(await unlinkTelegram(u), { ok: false, reason: "not_linked" });
    const again = await loginOrCreateTelegramUser(tg, { consentVersion: LEGAL_VERSION });
    assert.ok(again.ok && again.created && again.userId !== u);
  });

  it("аккаунту, созданному через Telegram, отвязывать нельзя: это единственный вход", async () => {
    const solo = await tgUser();
    assert.deepEqual(await unlinkTelegram(solo), { ok: false, reason: "no_password" });
    assert.ok((await loginOrCreateTelegramUser(tg)).ok);
  });
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { deleteAccount, identityHash } from "../src/lib/account-delete";
import { searchUsers } from "../src/lib/admin";
import { createSubscriptionCheckout, fulfillPayment } from "../src/lib/billing";
import { claimLead } from "../src/lib/claims";
import { SIGNUP_BONUS, getBalance, getLedger, unlockLead } from "../src/lib/credits";
import { __resetAppDbForTests } from "../src/lib/db";
import { getPlan } from "../src/lib/plans";
import { cleanProfile, createReport } from "../src/lib/reports";
import { createUser, loginOrCreateTelegramUser } from "../src/lib/users";

type Db = Awaited<ReturnType<typeof __resetAppDbForTests>>;
let db: Db;
const keep = process.env.ADMIN_EMAILS;

beforeEach(async () => {
  db = await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-del-")), "app.db"));
  process.env.ADMIN_EMAILS = "owner@test.ru";
});
afterEach(() => {
  if (keep === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = keep;
});

const count = async (table: string, userId: number) => Number((await db.execute({ sql: `SELECT count(*) AS n FROM ${table} WHERE user_id = ?`, args: [userId] })).rows[0].n);

describe("удаление аккаунта", () => {
  it("стирает всё, что идентифицирует человека, и оставляет обезличенные платежи и проводки", async () => {
    const r = await createUser("person@test.ru", "hash-123");
    assert.ok(r.ok);
    const u = r.userId;
    await db.execute({ sql: "UPDATE users SET tg_id = 777, tg_username = 'p', display_name = 'Имя' WHERE id = ?", args: [u] });
    await db.execute({ sql: "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES ('s', ?, 9999999999, 0)", args: [u] });
    await unlockLead(u, "L1");
    await db.execute({ sql: "INSERT INTO lead_notes(user_id, lead_id, status, note, updated_at) VALUES (?, 'L1', 'new', 'секрет', 1)", args: [u] });
    await db.execute({ sql: "INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at, kind) VALUES ('pay1', ?, 's100', 100, 49000, 'succeeded', 'yookassa', 1, 'credits')", args: [u] });
    const before = await getBalance(u);
    assert.ok(before > 0);

    const res = await deleteAccount(u);
    assert.deepEqual(res, { ok: true, forfeited: before });

    const row = (await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [u] })).rows[0];
    assert.equal(row.email, `deleted-${u}@deleted.invalid`);
    for (const k of ["pass_hash"]) assert.equal(row[k], "");
    for (const k of ["tg_id", "tg_username", "display_name", "ref_code", "referred_by"]) assert.equal(row[k], null, k);
    assert.equal(Number(row.balance), 0);
    assert.ok(Number(row.deleted_at) > 0);
    for (const t of ["sessions", "unlocks", "lead_notes", "lead_pitches", "lead_claims", "audit_reports"]) assert.equal(await count(t, u), 0, t);
    assert.equal(await count("payments", u), 1, "платёж остаётся");
    assert.ok((await getLedger(u)).some((l) => l.reason === "account_deleted" && l.delta === -before), "сгоревшие кредиты записаны");
  });

  it("подписка, владелец и повторное удаление не проходят", async () => {
    const u = (await createUser("sub@test.ru", "h")) as { ok: true; userId: number };
    const { paymentId } = await createSubscriptionCheckout({ id: u.userId, email: "x@y.ru" }, getPlan("freelance")!, 1, "https://x");
    await fulfillPayment(paymentId);
    assert.deepEqual(await deleteAccount(u.userId), { ok: false, reason: "subscription" });
    assert.equal(Number((await db.execute({ sql: "SELECT count(*) AS n FROM users WHERE id = ? AND deleted_at IS NULL", args: [u.userId] })).rows[0].n), 1);

    await db.execute("UPDATE subscriptions SET ends_at = 1");
    const ok = await deleteAccount(u.userId);
    assert.ok(ok.ok);
    assert.deepEqual(await deleteAccount(u.userId), { ok: false, reason: "not_found" });

    const owner = (await createUser("owner@test.ru", "h")) as { ok: true; userId: number };
    assert.deepEqual(await deleteAccount(owner.userId), { ok: false, reason: "admin" });
  });

  it("эксклюзивы и отчёты удалённого освобождаются и исчезают", async () => {
    const u = (await createUser("sub@test.ru", "h")) as { ok: true; userId: number };
    const { paymentId } = await createSubscriptionCheckout({ id: u.userId, email: "x@y.ru" }, getPlan("freelance")!, 1, "https://x");
    await fulfillPayment(paymentId);
    await unlockLead(u.userId, "HOT");
    assert.ok((await claimLead(u.userId, "HOT")).ok);
    assert.ok((await createReport(u.userId, { leadId: "HOT", leadName: "X", siteUrl: "https://x.ru", findings: [], profile: cleanProfile({ name: "A", contact: "@a" }) })).ok);
    await db.execute("UPDATE subscriptions SET ends_at = 1");
    assert.ok((await deleteAccount(u.userId)).ok);
    assert.equal(await count("lead_claims", u.userId), 0);
    assert.equal(await count("audit_reports", u.userId), 0);
  });

  it("после удаления та же почта и тот же Telegram регистрируются снова, но без приветственных кредитов", async () => {
    const a = (await createUser("again@test.ru", "h")) as { ok: true; userId: number };
    assert.equal(await getBalance(a.userId), SIGNUP_BONUS);
    assert.ok((await deleteAccount(a.userId)).ok);
    const b = await createUser("Again@Test.ru", "h2");
    assert.ok(b.ok && b.userId !== a.userId, "почта освободилась");
    assert.equal(await getBalance(b.userId), 0, "бонус второй раз не даём");
    assert.equal((await getLedger(b.userId)).filter((l) => l.reason === "signup_bonus").length, 0);

    const tg = { id: 5151, name: "Анна", username: "anna" };
    const t1 = await loginOrCreateTelegramUser(tg, { consentVersion: "1" });
    assert.ok(t1.ok);
    assert.equal(await getBalance(t1.userId), SIGNUP_BONUS);
    await deleteAccount(t1.userId);
    const t2 = await loginOrCreateTelegramUser(tg, { consentVersion: "1" });
    assert.ok(t2.ok && t2.created && t2.userId !== t1.userId);
    assert.equal(await getBalance(t2.userId), 0);
  });

  it("новый человек получает бонус, а в таблице только необратимые хеши", async () => {
    const x = await createUser("new@test.ru", "h");
    assert.ok(x.ok);
    assert.equal(await getBalance(x.userId), SIGNUP_BONUS);
    const del = (await createUser("old@test.ru", "h")) as { ok: true; userId: number };
    await deleteAccount(del.userId);
    const hashes = (await db.execute("SELECT hash FROM deleted_identities")).rows.map((r) => String(r.hash));
    assert.deepEqual(hashes, [identityHash("email", "old@test.ru")]);
    assert.ok(hashes.every((h) => /^[0-9a-f]{64}$/.test(h)) && !hashes.join("").includes("old@test"));
  });

  it("хеши старше года чистятся, удалённые не показываются в админке", async () => {
    const old = (await createUser("ancient@test.ru", "h")) as { ok: true; userId: number };
    await deleteAccount(old.userId);
    await db.execute("UPDATE deleted_identities SET created_at = 1");
    const other = (await createUser("other@test.ru", "h")) as { ok: true; userId: number };
    await deleteAccount(other.userId);
    const rows = (await db.execute("SELECT hash FROM deleted_identities")).rows.map((r) => String(r.hash));
    assert.deepEqual(rows, [identityHash("email", "other@test.ru")], "старый хеш удалён при очередном удалении");

    await createUser("visible@test.ru", "h");
    assert.deepEqual((await searchUsers("")).map((x) => x.email), ["visible@test.ru"]);
  });
});

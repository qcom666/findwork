import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { fulfillPayment } from "../src/lib/billing";
import { getBalance, getLedger } from "../src/lib/credits";
import { appDb, __resetAppDbForTests } from "../src/lib/db";
import { createUser, getReferralInfo, newRefCode } from "../src/lib/users";

async function pending(id: string, userId: number) {
  await (await appDb()).execute({
    sql: "INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at) VALUES (?, ?, 's20', 20, 49000, 'pending', 'yookassa', 0)",
    args: [id, userId],
  });
}

beforeEach(async () => {
  delete process.env.REFERRAL_REWARD_CREDITS;
  await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-ref-")), "app.db"));
});

async function make(email: string, ref?: string | null) {
  const r = await createUser(email, "hash", ref);
  assert.ok(r.ok);
  return r.userId;
}
const codeOf = async (id: number) => String((await (await appDb()).execute({ sql: "SELECT ref_code FROM users WHERE id = ?", args: [id] })).rows[0].ref_code);

describe("реферальная программа", () => {
  it("у каждого пользователя свой код, бонус за регистрацию начислен", async () => {
    const a = await make("a@t.ru"), b = await make("b@t.ru");
    assert.notEqual(await codeOf(a), await codeOf(b));
    assert.match(await codeOf(a), /^[a-z2-9]{8}$/);
    assert.equal(await getBalance(a), 5);
  });

  it("повторный e-mail не создаёт пользователя", async () => {
    await make("a@t.ru");
    assert.deepEqual(await createUser(" A@T.ru ", "hash"), { ok: false, error: "Этот e-mail уже зарегистрирован" });
  });

  it("приглашённый запоминает пригласившего, неизвестный и мусорный код игнорируются", async () => {
    const a = await make("a@t.ru");
    const b = await make("b@t.ru", await codeOf(a));
    const c = await make("c@t.ru", "doesnotexist");
    const d = await make("d@t.ru", "'; drop table users; --");
    const db = await appDb();
    const by = async (id: number) => (await db.execute({ sql: "SELECT referred_by FROM users WHERE id = ?", args: [id] })).rows[0].referred_by;
    assert.equal(Number(await by(b)), a);
    assert.equal(await by(c), null);
    assert.equal(await by(d), null);
  });

  it("награда пригласившему: один раз, за первую покупку приглашённого", async () => {
    const a = await make("a@t.ru");
    const b = await make("b@t.ru", await codeOf(a));
    await pending("p1", b);
    assert.equal(await fulfillPayment("p1"), true);
    assert.equal(await getBalance(a), 5 + 10);
    assert.equal(await getBalance(b), 5 + 20);

    await pending("p2", b);
    await fulfillPayment("p2");
    assert.equal(await getBalance(a), 15, "за вторую покупку награды нет");
    assert.equal((await getLedger(a)).filter((l) => l.reason === "referral").length, 1);

    await fulfillPayment("p1"); // повторная обработка того же платежа
    assert.equal(await getBalance(a), 15);
  });

  it("без пригласившего награды нет, а размер награды настраивается и 0 её выключает", async () => {
    const solo = await make("solo@t.ru");
    await pending("p1", solo);
    await fulfillPayment("p1");
    assert.equal(await getBalance(solo), 25);

    process.env.REFERRAL_REWARD_CREDITS = "0";
    const a = await make("a@t.ru");
    const b = await make("b@t.ru", await codeOf(a));
    await pending("p2", b);
    await fulfillPayment("p2");
    assert.equal(await getBalance(a), 5);

    process.env.REFERRAL_REWARD_CREDITS = "25";
    const c = await make("c@t.ru", await codeOf(a));
    await pending("p3", c);
    await fulfillPayment("p3");
    assert.equal(await getBalance(a), 5 + 25);
  });

  it("статистика: приглашено, купили, заработано; код создаётся у старых аккаунтов", async () => {
    const a = await make("a@t.ru");
    const code = await codeOf(a);
    const b = await make("b@t.ru", code);
    await make("c@t.ru", code);
    await pending("p1", b);
    await fulfillPayment("p1");
    assert.deepEqual(await getReferralInfo(a), { code, invited: 2, paid: 1, earned: 10 });

    const db = await appDb();
    await db.execute({ sql: "INSERT INTO users(email, pass_hash, balance, created_at) VALUES ('old@t.ru', 'x', 0, 0)" });
    const oldId = Number((await db.execute("SELECT id FROM users WHERE email = 'old@t.ru'")).rows[0].id);
    const info = await getReferralInfo(oldId);
    assert.match(info.code, /^[a-z2-9]{8}$/);
    assert.equal((await getReferralInfo(oldId)).code, info.code, "код не меняется при повторном обращении");
  });

  it("случайные коды не повторяются на практике", () => {
    const s = new Set(Array.from({ length: 500 }, newRefCode));
    assert.equal(s.size, 500);
  });
});

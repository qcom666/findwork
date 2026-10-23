import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { adjustCredits, searchUsers } from "../src/lib/admin";
import { getBalance, getLedger } from "../src/lib/credits";
import { appDb, __resetAppDbForTests } from "../src/lib/db";
import { createPromo, createPromoBatch, listPromos, redeemPromo, revokePromo } from "../src/lib/promo";

async function user(email: string, balance = 0): Promise<number> {
  const r = await (await appDb()).execute({ sql: "INSERT INTO users(email, pass_hash, balance, created_at) VALUES (?, 'x', ?, 100)", args: [email, balance] });
  return Number(r.lastInsertRowid);
}

beforeEach(async () => {
  await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-admin-")), "app.db"));
});

describe("пачка промокодов", () => {
  it("создаёт нужное число уникальных одноразовых кодов с префиксом", async () => {
    const r = await createPromoBatch({ count: 25, credits: 15, prefix: "blog!", note: "партнёры" });
    assert.ok(r.ok);
    assert.equal(r.codes.length, 25);
    assert.equal(new Set(r.codes).size, 25);
    for (const c of r.codes) assert.match(c, /^BLOG-[A-Z2-9]{8}$/);
    const list = await listPromos(100);
    assert.equal(list.length, 25);
    assert.ok(list.every((p) => p.maxUses === 1 && p.credits === 15 && p.note === "партнёры"));
  });

  it("каждый код пачки работает один раз", async () => {
    const r = await createPromoBatch({ count: 2, credits: 5 });
    assert.ok(r.ok);
    const a = await user("a@t.ru"), b = await user("b@t.ru");
    assert.equal((await redeemPromo(a, r.codes[0])).ok, true);
    assert.deepEqual(await redeemPromo(b, r.codes[0]), { ok: false, reason: "exhausted" });
    assert.equal((await redeemPromo(b, r.codes[1])).ok, true);
  });

  it("границы количества", async () => {
    assert.equal((await createPromoBatch({ count: 0, credits: 5 })).ok, false);
    assert.equal((await createPromoBatch({ count: 101, credits: 5 })).ok, false);
    assert.equal((await createPromoBatch({ count: 3, credits: 0 })).ok, false);
  });
});

describe("отзыв промокода", () => {
  it("отозванный код нельзя использовать, уже начисленное остаётся", async () => {
    await createPromo({ code: "GIFT", credits: 10 });
    const a = await user("a@t.ru"), b = await user("b@t.ru");
    await (await appDb()).execute({ sql: "UPDATE users SET tg_id = id WHERE id IN (?, ?)", args: [a, b] }); // общий код только для подтверждённых
    assert.equal((await redeemPromo(a, "GIFT")).ok, true);
    assert.equal(await revokePromo(" gift "), true);
    assert.deepEqual(await redeemPromo(b, "GIFT"), { ok: false, reason: "revoked" });
    assert.equal(await getBalance(a), 10);
    assert.equal(await getBalance(b), 0);
    assert.equal((await listPromos())[0].revoked, true);
    assert.equal(await revokePromo("NOSUCH"), false);
  });
});

describe("ручное начисление кредитов", () => {
  it("начисляет и пишет проводку с причиной", async () => {
    const u = await user("a@t.ru", 3);
    assert.deepEqual(await adjustCredits(u, 20, "  возврат за двойное списание "), { ok: true, balance: 23 });
    const row = (await getLedger(u))[0];
    assert.deepEqual([row.reason, row.delta, row.ref], ["admin", 20, "возврат за двойное списание"]);
  });

  it("списывает, но не ниже нуля", async () => {
    const u = await user("a@t.ru", 5);
    assert.deepEqual(await adjustCredits(u, -5, "корректировка"), { ok: true, balance: 0 });
    const r = await adjustCredits(u, -1, "лишнее");
    assert.equal(r.ok, false);
    assert.equal(await getBalance(u), 0);
    assert.equal((await getLedger(u)).filter((l) => l.reason === "admin").length, 1);
  });

  it("отклоняет ноль, мусор, огромные суммы и несуществующего пользователя", async () => {
    const u = await user("a@t.ru", 5);
    for (const bad of [0, NaN, 10001, -10001]) assert.equal((await adjustCredits(u, bad, "x")).ok, false, String(bad));
    assert.deepEqual(await adjustCredits(999, 5, "x"), { ok: false, error: "Пользователь не найден" });
    assert.equal(await getBalance(u), 5);
  });

  it("параллельные списания не уводят баланс в минус", async () => {
    const u = await user("a@t.ru", 10);
    const res = await Promise.all(Array.from({ length: 5 }, () => adjustCredits(u, -4, "гонка")));
    assert.equal(res.filter((r) => r.ok).length, 2);
    assert.equal(await getBalance(u), 2);
  });
});

describe("поиск пользователей", () => {
  it("ищет по части e-mail без учёта регистра, новые выше", async () => {
    await user("anna@mail.ru"); await user("boris@gmail.com"); await user("Anna.k@gmail.com");
    assert.deepEqual((await searchUsers("ANNA")).map((u) => u.email), ["Anna.k@gmail.com", "anna@mail.ru"]);
    assert.equal((await searchUsers("")).length, 3);
    assert.equal((await searchUsers("gmail")).length, 2);
  });

  it("знаки % и _ ищутся как обычные символы, а не как маски", async () => {
    await user("a_b@t.ru"); await user("axb@t.ru"); await user("100%@t.ru");
    assert.deepEqual((await searchUsers("a_b")).map((u) => u.email), ["a_b@t.ru"]);
    assert.deepEqual((await searchUsers("%")).map((u) => u.email), ["100%@t.ru"]);
  });

  it("считает открытия и деньги только по боевым платежам", async () => {
    const u = await user("a@t.ru");
    const db = await appDb();
    await db.execute({ sql: "INSERT INTO unlocks(user_id, lead_id, created_at) VALUES (?, 'l1', 0), (?, 'l2', 0)", args: [u, u] });
    const pay = (id: string, st: string, prov: string) =>
      db.execute({ sql: "INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at) VALUES (?, ?, 's20', 20, 49000, ?, ?, 0)", args: [id, u, st, prov] });
    await pay("p1", "succeeded", "yookassa"); await pay("p2", "succeeded", "mock"); await pay("p3", "pending", "yookassa");
    const [row] = await searchUsers("a@t");
    assert.equal(row.unlocks, 2);
    assert.equal(row.paidRub, 490);
  });
});

describe("начисление по e-mail", () => {
  it("находит пользователя без учёта регистра и пробелов", async () => {
    const { adjustCreditsByEmail } = await import("../src/lib/admin");
    const u = await user("owner@t.ru", 1);
    assert.deepEqual(await adjustCreditsByEmail("  Owner@T.ru ", 50, "себе на тесты"), { ok: true, balance: 51, email: "owner@t.ru" });
    assert.equal(await getBalance(u), 51);
  });
  it("неизвестный и пустой e-mail ничего не меняют", async () => {
    const { adjustCreditsByEmail } = await import("../src/lib/admin");
    const u = await user("a@t.ru", 1);
    assert.equal((await adjustCreditsByEmail("nobody@t.ru", 5, "")).ok, false);
    assert.equal((await adjustCreditsByEmail("   ", 5, "")).ok, false);
    assert.equal(await getBalance(u), 1);
  });
});

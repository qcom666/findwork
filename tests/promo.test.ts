import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { getBalance, getLedger } from "../src/lib/credits";
import { appDb, __resetAppDbForTests } from "../src/lib/db";
import { createPromo, listPromos, normalizeCode, redeemPromo } from "../src/lib/promo";

let n = 0;
/** Пользователь с привязанным Telegram (подтверждённый). unverified: только почта, как у фермы аккаунтов. */
async function user(balance = 0, unverified = false): Promise<number> {
  const i = ++n;
  const r = await (await appDb()).execute({
    sql: "INSERT INTO users(email, pass_hash, balance, created_at, tg_id) VALUES (?, 'x', ?, 0, ?)",
    args: [`p${i}@t.ru`, balance, unverified ? null : 1000 + i],
  });
  return Number(r.lastInsertRowid);
}

beforeEach(async () => {
  await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-promo-")), "app.db"));
});

describe("промокоды", () => {
  it("код нормализуется: регистр и пробелы не важны", () => {
    assert.equal(normalizeCode("  spring 10 "), "SPRING10");
  });

  it("начисляет кредиты один раз на человека и пишет проводку", async () => {
    await createPromo({ code: "SPRING10", credits: 10 });
    const u = await user(1);
    assert.deepEqual(await redeemPromo(u, " spring10 "), { ok: true, credits: 10, balance: 11 });
    assert.deepEqual(await redeemPromo(u, "SPRING10"), { ok: false, reason: "already" });
    assert.equal(await getBalance(u), 11);
    assert.equal((await getLedger(u)).filter((l) => l.reason === "promo").length, 1);
  });

  it("неизвестный, просроченный и исчерпанный коды не начисляют ничего", async () => {
    await createPromo({ code: "OLD", credits: 5 });
    await (await appDb()).execute("UPDATE promo_codes SET expires_at = 1 WHERE code = 'OLD'");
    await createPromo({ code: "ONE", credits: 5, maxUses: 1 });
    const a = await user(), b = await user();
    assert.deepEqual(await redeemPromo(a, "NOPE"), { ok: false, reason: "invalid" });
    assert.deepEqual(await redeemPromo(a, "OLD"), { ok: false, reason: "expired" });
    assert.equal((await redeemPromo(a, "ONE")).ok, true);
    assert.deepEqual(await redeemPromo(b, "ONE"), { ok: false, reason: "exhausted" });
    assert.equal(await getBalance(b), 0);
  });

  it("мусор и попытки внедрения в код отклоняются как несуществующий код", async () => {
    const u = await user();
    for (const bad of ["", "ab", "x".repeat(40), "'; DROP TABLE users; --", "код-по-русски"]) {
      assert.deepEqual(await redeemPromo(u, bad), { ok: false, reason: "invalid" }, bad);
    }
  });

  it("общий код только для подтверждённых: Telegram или оплата; одноразовый код работает у всех", async () => {
    await createPromo({ code: "PUBLIC", credits: 5 });
    await createPromo({ code: "PARTNER", credits: 5, maxUses: 1 });
    const farm = await user(0, true);
    assert.deepEqual(await redeemPromo(farm, "PUBLIC"), { ok: false, reason: "verify" });
    assert.equal(await getBalance(farm), 0);
    assert.equal((await redeemPromo(farm, "PARTNER")).ok, true, "одноразовый код партнёра фармить нечем");

    const payer = await user(0, true);
    await (await appDb()).execute({
      sql: "INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at) VALUES ('p-ok', ?, 's100', 100, 49000, 'succeeded', 'yookassa', 0)",
      args: [payer],
    });
    assert.equal((await redeemPromo(payer, "PUBLIC")).ok, true, "оплативший подтверждён");
    assert.equal((await redeemPromo(await user(), "PUBLIC")).ok, true, "с Telegram подтверждён");
  });

  it("параллельные использования лимитного кода не превышают лимит", async () => {
    await createPromo({ code: "RACE", credits: 3, maxUses: 2 });
    const ids = await Promise.all([user(), user(), user(), user(), user()]);
    const res = await Promise.all(ids.map((id) => redeemPromo(id, "RACE")));
    assert.equal(res.filter((r) => r.ok).length, 2);
    assert.equal((await listPromos())[0].used, 2);
  });

  it("создание: случайный код, проверка границ и дубликатов", async () => {
    const r = await createPromo({ credits: 20, days: 7, note: "для блогера" });
    assert.ok(r.ok && /^FW-[A-Z2-9]{8}$/.test(r.code));
    assert.deepEqual(await createPromo({ code: "DUP", credits: 1 }), { ok: true, code: "DUP" });
    assert.deepEqual(await createPromo({ code: "dup", credits: 1 }), { ok: false, error: "Такой код уже есть" });
    assert.equal((await createPromo({ credits: 0 })).ok, false);
    assert.equal((await createPromo({ credits: 5000 })).ok, false);
    assert.equal((await createPromo({ credits: 5, maxUses: 0 })).ok, false);
    assert.equal((await createPromo({ credits: 5, days: 0 })).ok, false);
    assert.equal((await createPromo({ code: "!!", credits: 5 })).ok, false);
  });
});

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";

import { createCheckout, fulfillPayment, getPackage, getPayment, settleByProviderId, yookassaIpAllowed } from "../src/lib/billing";
import { getBalance, getLedger, isUnlocked, unlockLead, unlockMany } from "../src/lib/credits";
import { __resetAppDbForTests } from "../src/lib/db";
import { maskEmail, maskPhone, socialNames } from "../src/lib/mask";
import { safeNext } from "../src/lib/nav";
import { hashPassword, verifyPassword } from "../src/lib/password";

type Db = Awaited<ReturnType<typeof __resetAppDbForTests>>;
let db: Db;
let n = 0;

async function newUser(balance: number): Promise<number> {
  const r = await db.execute({
    sql: "INSERT INTO users(email, pass_hash, balance, created_at) VALUES (?, 'x', ?, 0)",
    args: [`u${++n}@test.ru`, balance],
  });
  return Number(r.lastInsertRowid);
}

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fw-test-"));
  db = await __resetAppDbForTests("file:" + path.join(dir, "app.db"));
});

describe("разблокировка лидов", () => {
  it("списывает кредит один раз, повторное открытие бесплатно", async () => {
    const u = await newUser(3);
    const a = await unlockLead(u, "lead-1");
    const b = await unlockLead(u, "lead-1");
    assert.deepEqual(a, { ok: true, charged: 1, balance: 2 });
    assert.deepEqual(b, { ok: true, charged: 0, balance: 2 });
    assert.equal(await getBalance(u), 2);
    assert.equal(await isUnlocked(u, "lead-1"), true);
    assert.equal((await getLedger(u)).filter((l) => l.reason === "unlock").length, 1);
  });

  it("без кредитов не открывает и ничего не меняет", async () => {
    const u = await newUser(0);
    const r = await unlockLead(u, "lead-1");
    assert.equal(r.ok, false);
    assert.equal(await isUnlocked(u, "lead-1"), false);
    assert.equal((await getLedger(u)).length, 0);
    assert.equal(await getBalance(u), 0);
  });

  it("параллельные открытия одного лида списывают один кредит", async () => {
    const u = await newUser(5);
    const res = await Promise.all(Array.from({ length: 6 }, () => unlockLead(u, "lead-x")));
    assert.ok(res.every((r) => r.ok));
    assert.equal(await getBalance(u), 4);
    assert.equal((await getLedger(u)).length, 1);
  });

  it("параллельные открытия разных лидов не уводят баланс в минус", async () => {
    const u = await newUser(2);
    const res = await Promise.all(Array.from({ length: 5 }, (_, i) => unlockLead(u, `lead-${i}`)));
    assert.equal(res.filter((r) => r.ok).length, 2);
    assert.equal(await getBalance(u), 0);
  });

  it("лиды разных пользователей независимы", async () => {
    const a = await newUser(1), b = await newUser(1);
    await unlockLead(a, "lead-1");
    assert.equal(await isUnlocked(b, "lead-1"), false);
  });
});

describe("открытие пачкой", () => {
  it("списывает только за новые, уже открытые и дубли бесплатны", async () => {
    const u = await newUser(10);
    await unlockLead(u, "a");
    const r = await unlockMany(u, ["a", "b", "c", "b"]);
    assert.deepEqual(r, { ok: true, opened: 2, charged: 2, balance: 7 });
    assert.equal(await getBalance(u), 7);
    for (const id of ["a", "b", "c"]) assert.equal(await isUnlocked(u, id), true);
    assert.equal((await getLedger(u)).filter((l) => l.reason === "unlock").length, 3);
  });

  it("не хватает кредитов: не открывается ничего и баланс не меняется", async () => {
    const u = await newUser(2);
    const r = await unlockMany(u, ["a", "b", "c"]);
    assert.deepEqual(r, { ok: false, reason: "insufficient", need: 3, balance: 2 });
    assert.equal(await getBalance(u), 2);
    assert.equal(await isUnlocked(u, "a"), false);
    assert.equal((await getLedger(u)).length, 0);
  });

  it("повторный вызов с теми же лидами ничего не списывает", async () => {
    const u = await newUser(5);
    await unlockMany(u, ["a", "b"]);
    const again = await unlockMany(u, ["a", "b"]);
    assert.deepEqual(again, { ok: true, opened: 0, charged: 0, balance: 3 });
  });

  it("параллельные пачки не уводят баланс в минус", async () => {
    const u = await newUser(3);
    const res = await Promise.all([unlockMany(u, ["a", "b"]), unlockMany(u, ["c", "d"]), unlockMany(u, ["e", "f"])]);
    assert.equal(res.filter((r) => r.ok).length, 1);
    assert.equal(await getBalance(u), 1);
  });
});

describe("платежи", () => {
  it("fulfillPayment зачисляет кредиты ровно один раз", async () => {
    const u = await newUser(0);
    await db.execute({
      sql: "INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at) VALUES ('p1', ?, 's20', 20, 49000, 'pending', 'mock', 0)",
      args: [u],
    });
    const results = await Promise.all([fulfillPayment("p1"), fulfillPayment("p1"), fulfillPayment("p1")]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await getBalance(u), 20);
    assert.equal((await getLedger(u)).filter((l) => l.reason === "purchase").length, 1);
  });

  describe("ЮKassa (поддельный сервер)", () => {
    let server: http.Server;
    let base = "";
    let requests: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
    let behaviour: (req: http.IncomingMessage, body: string) => { status: number; json: unknown } = () => ({ status: 500, json: {} });

    before(async () => {
      server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
          const r = behaviour(req, body);
          res.writeHead(r.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(r.json));
        });
      });
      await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v3`;
      process.env.YOOKASSA_SHOP_ID = "shop-123";
      process.env.YOOKASSA_SECRET_KEY = "secret-key";
      process.env.YOOKASSA_API_URL = base;
    });
    after(() => {
      server.close();
      delete process.env.YOOKASSA_SHOP_ID;
      delete process.env.YOOKASSA_SECRET_KEY;
      delete process.env.YOOKASSA_API_URL;
      delete process.env.YOOKASSA_RECEIPT;
    });
    beforeEach(() => {
      requests = [];
    });

    it("создаёт платёж по документации: Basic-авторизация, Idempotence-Key, сумма строкой, return_url", async () => {
      const u = await newUser(0);
      behaviour = () => ({ status: 200, json: { id: "yoo-1", status: "pending", confirmation: { confirmation_url: "https://yoomoney.ru/pay/yoo-1" } } });
      const r = await createCheckout({ id: u, email: "a@b.ru" }, getPackage("s60")!, "https://findwork.example");

      assert.equal(r.url, "https://yoomoney.ru/pay/yoo-1");
      const req = requests[0];
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v3/payments");
      assert.equal(req.headers.authorization, "Basic " + Buffer.from("shop-123:secret-key").toString("base64"));
      assert.equal(req.headers["idempotence-key"], r.paymentId);
      const body = JSON.parse(req.body);
      assert.deepEqual(body.amount, { value: "1190.00", currency: "RUB" });
      assert.equal(body.capture, true);
      assert.deepEqual(body.confirmation, { type: "redirect", return_url: `https://findwork.example/billing/return?payment=${r.paymentId}` });
      assert.equal(body.metadata.payment_id, r.paymentId);
      assert.ok(body.description.length <= 128);
      assert.equal(body.receipt, undefined);

      const p = await getPayment(u, r.paymentId);
      assert.equal(p?.status, "pending");
      assert.equal(p?.providerPaymentId, "yoo-1");
    });

    it("добавляет чек, когда включён YOOKASSA_RECEIPT", async () => {
      process.env.YOOKASSA_RECEIPT = "1";
      const u = await newUser(0);
      behaviour = () => ({ status: 200, json: { id: "yoo-r", status: "pending", confirmation: { confirmation_url: "https://pay" } } });
      await createCheckout({ id: u, email: "buyer@x.ru" }, getPackage("s20")!, "https://x");
      const body = JSON.parse(requests[0].body);
      assert.equal(body.receipt.customer.email, "buyer@x.ru");
      assert.equal(body.receipt.items[0].amount.value, "490.00");
      assert.equal(body.receipt.items[0].vat_code, 1);
      delete process.env.YOOKASSA_RECEIPT;
    });

    it("при ошибке ЮKassa помечает платёж как failed и бросает ошибку", async () => {
      const u = await newUser(0);
      behaviour = () => ({ status: 400, json: { type: "error" } });
      await assert.rejects(createCheckout({ id: u, email: "a@b.ru" }, getPackage("s20")!, "https://x"));
      const row = (await db.execute("SELECT status FROM payments")).rows[0];
      assert.equal(row.status, "failed");
    });

    async function pendingPayment(u: number, providerId: string) {
      behaviour = () => ({ status: 200, json: { id: providerId, status: "pending", confirmation: { confirmation_url: "https://pay" } } });
      const r = await createCheckout({ id: u, email: "a@b.ru" }, getPackage("s20")!, "https://x");
      requests = [];
      return r.paymentId;
    }

    it("вебхук: успешный платёж зачисляет кредиты один раз, даже если уведомление придёт дважды", async () => {
      const u = await newUser(0);
      await pendingPayment(u, "yoo-ok");
      behaviour = () => ({ status: 200, json: { id: "yoo-ok", status: "succeeded", paid: true, amount: { value: "490.00", currency: "RUB" } } });
      assert.equal(await settleByProviderId("yoo-ok"), "succeeded");
      assert.equal(await settleByProviderId("yoo-ok"), "succeeded");
      assert.equal(await getBalance(u), 20);
      assert.equal(requests[0].url, "/v3/payments/yoo-ok");
      assert.equal(requests[0].method, "GET");
    });

    it("не зачисляет, если сумма у ЮKassa не совпала с нашей", async () => {
      const u = await newUser(0);
      await pendingPayment(u, "yoo-bad");
      behaviour = () => ({ status: 200, json: { id: "yoo-bad", status: "succeeded", paid: true, amount: { value: "1.00", currency: "RUB" } } });
      assert.equal(await settleByProviderId("yoo-bad"), "mismatch");
      assert.equal(await getBalance(u), 0);
    });

    it("не зачисляет, если ЮKassa говорит, что платёж не оплачен, хотя в уведомлении было иное", async () => {
      const u = await newUser(0);
      await pendingPayment(u, "yoo-pend");
      behaviour = () => ({ status: 200, json: { id: "yoo-pend", status: "pending", paid: false, amount: { value: "490.00", currency: "RUB" } } });
      assert.equal(await settleByProviderId("yoo-pend"), "pending");
      assert.equal(await getBalance(u), 0);
    });

    it("отменённый платёж помечается canceled и ничего не зачисляет", async () => {
      const u = await newUser(0);
      const id = await pendingPayment(u, "yoo-cancel");
      behaviour = () => ({ status: 200, json: { id: "yoo-cancel", status: "canceled", paid: false } });
      assert.equal(await settleByProviderId("yoo-cancel"), "canceled");
      assert.equal((await getPayment(u, id))?.status, "canceled");
      assert.equal(await getBalance(u), 0);
    });

    it("неизвестный id платежа игнорируется без запроса к ЮKassa", async () => {
      assert.equal(await settleByProviderId("nope"), "unknown");
      assert.equal(requests.length, 0);
    });

    it("временная ошибка ЮKassa пробрасывается, чтобы вебхук ответил 500 и был повторён", async () => {
      const u = await newUser(0);
      await pendingPayment(u, "yoo-err");
      behaviour = () => ({ status: 503, json: {} });
      await assert.rejects(settleByProviderId("yoo-err"));
      assert.equal(await getBalance(u), 0);
    });
  });

  it("проверка IP источников ЮKassa", () => {
    assert.equal(yookassaIpAllowed("185.71.76.10"), true);
    assert.equal(yookassaIpAllowed("77.75.156.11"), true);
    assert.equal(yookassaIpAllowed("77.75.156.12"), false);
    assert.equal(yookassaIpAllowed("77.75.154.200"), true);
    assert.equal(yookassaIpAllowed("8.8.8.8"), false);
    assert.equal(yookassaIpAllowed("2a02:5180:1::1"), true);
    assert.equal(yookassaIpAllowed("not-an-ip"), false);
  });
});

describe("пароли", () => {
  it("хэш проверяется, чужой пароль нет, формат повреждённого хэша не падает", async () => {
    const h = await hashPassword("correct horse");
    assert.equal(await verifyPassword("correct horse", h), true);
    assert.equal(await verifyPassword("wrong", h), false);
    assert.equal(await verifyPassword("x", "garbage"), false);
    assert.notEqual(h, await hashPassword("correct horse")); // соль случайная
  });
});

describe("скрытие контактов", () => {
  it("маски не раскрывают номер и ящик", () => {
    assert.equal(maskPhone("+78432485816"), "+7 (843) •••-••-••");
    assert.equal(maskEmail("owner@shop.ru"), "•••@shop.ru");
    assert.equal(maskPhone(null), null);
    assert.deepEqual(socialNames(["https://vk.com/a", "https://www.instagram.com/b", "https://vk.com/c"]), ["ВКонтакте", "Instagram"]);
    assert.ok(!maskPhone("+78432485816")!.includes("2485816"));
  });

  it("safeNext пропускает только пути внутри сайта", () => {
    assert.equal(safeNext("/lead/1"), "/lead/1");
    assert.equal(safeNext("//evil.com"), "/");
    assert.equal(safeNext("https://evil.com"), "/");
    assert.equal(safeNext("/\\evil.com"), "/");
    assert.equal(safeNext(undefined), "/");
  });
});

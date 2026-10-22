import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { listPayments } from "../src/lib/billing";
import { appDb, __resetAppDbForTests } from "../src/lib/db";
import { listReceipts, parseReceiptUrl, receiptTitle, setReceipt } from "../src/lib/receipts";

const RECEIPT = "https://lknpd.nalog.ru/api/v1/receipt/123456789012/200abcdef1/print";

async function user(email: string, extra: { tg?: string; deleted?: boolean } = {}): Promise<number> {
  const r = await (await appDb()).execute({
    sql: "INSERT INTO users(email, pass_hash, balance, created_at, tg_username, deleted_at) VALUES (?, 'x', 0, 0, ?, ?)",
    args: [email, extra.tg ?? null, extra.deleted ? 1 : null],
  });
  return Number(r.lastInsertRowid);
}

async function payment(id: string, userId: number, o: { status?: string; provider?: string; paidAt?: number; kind?: string; planId?: string; months?: number; credits?: number; kop?: number } = {}) {
  await (await appDb()).execute({
    sql: `INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at, paid_at, kind, plan_id, months)
          VALUES (?, ?, 's100', ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    args: [id, userId, o.credits ?? 100, o.kop ?? 49000, o.status ?? "succeeded", o.provider ?? "yookassa", o.paidAt ?? 1000, o.kind ?? "credits", o.planId ?? null, o.months ?? null],
  });
}

beforeEach(async () => {
  await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-receipts-")), "app.db"));
});

describe("чеки самозанятого", () => {
  it("наименование для «Мой налог» по пакету и по подписке", () => {
    assert.equal(receiptTitle({ kind: "credits", credits: 100, planId: null, months: null }), "Доступ к сервису Lidomap: пакет 100 кредитов");
    assert.equal(receiptTitle({ kind: "subscription", credits: 4500, planId: "studio", months: 3 }), "Подписка на сервис Lidomap «Студия», 3 месяца");
  });

  it("в очереди только оплаченные через ЮKassa и без чека, старые первыми", async () => {
    const u = await user("buyer@example.com");
    await payment("new", u, { paidAt: 2000 });
    await payment("old", u, { paidAt: 1000, kop: 149000, credits: 400 });
    await payment("pending", u, { status: "pending" });
    await payment("mock", u, { provider: "mock" });
    const q = await listReceipts(false);
    assert.deepEqual(q.map((x) => x.paymentId), ["old", "new"]);
    assert.equal(q[0].amountRub, 1490);
    assert.equal(q[0].contact, "buyer@example.com");
    assert.equal(q[0].hasEmail, true);
  });

  it("для аккаунта из Telegram и удалённого аккаунта почты нет", async () => {
    await payment("tg", await user("tg77@telegram.invalid", { tg: "ivan" }));
    await payment("gone", await user("deleted-5@deleted.invalid", { deleted: true }), { paidAt: 2000 });
    const [tg, gone] = await listReceipts(false);
    assert.equal(tg.contact, "Telegram @ivan");
    assert.equal(tg.hasEmail, false);
    assert.match(gone.contact, /удалён/);
  });

  it("ссылка принимается только с сайта налоговой по https", () => {
    assert.equal(parseReceiptUrl(` ${RECEIPT} `), RECEIPT);
    assert.equal(parseReceiptUrl("http://lknpd.nalog.ru/x"), null);
    assert.equal(parseReceiptUrl("https://nalog.ru.evil.com/x"), null);
    assert.equal(parseReceiptUrl("не ссылка"), null);
  });

  it("сохранённый чек уходит из очереди и виден покупателю, пустая ссылка возвращает в очередь", async () => {
    const u = await user("buyer@example.com");
    await payment("p1", u);
    assert.deepEqual(await setReceipt("p1", "https://example.com/r"), { ok: false, error: "Нужна ссылка на чек из «Мой налог»: https://lknpd.nalog.ru/…" });
    assert.deepEqual(await setReceipt("p1", RECEIPT), { ok: true });
    assert.equal((await listReceipts(false)).length, 0);
    assert.equal((await listReceipts(true))[0].receiptUrl, RECEIPT);
    assert.equal((await listPayments(u))[0].receiptUrl, RECEIPT);

    assert.deepEqual(await setReceipt("p1", ""), { ok: true });
    assert.equal((await listReceipts(false)).length, 1);
    assert.equal((await listPayments(u))[0].receiptUrl, null);
  });

  it("к неоплаченному или тестовому платежу чек не прикрепить", async () => {
    const u = await user("buyer@example.com");
    await payment("pending", u, { status: "pending" });
    await payment("mock", u, { provider: "mock" });
    assert.equal((await setReceipt("pending", RECEIPT)).ok, false);
    assert.equal((await setReceipt("mock", RECEIPT)).ok, false);
    assert.equal((await setReceipt("nope", RECEIPT)).ok, false);
  });
});

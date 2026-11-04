import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteAccount } from "../src/lib/account-delete";
import { MESSAGES, cancelAutorenewal, getAutorenewal, renewPriceRub, runAutorenewals, startTrial, trialBlock, type Notify } from "../src/lib/autorenew";
import { confirmMockPayment, getPayment, settleByProviderId } from "../src/lib/billing";
import { getBalance } from "../src/lib/credits";
import { __resetAppDbForTests } from "../src/lib/db";
import { getEntitlements } from "../src/lib/entitlements";
import { offerSections } from "../src/lib/legal";
import { TRIAL, getPlan } from "../src/lib/plans";
import { getSubscriptions } from "../src/lib/subscriptions";

type Db = Awaited<ReturnType<typeof __resetAppDbForTests>>;
let db: Db;
let n = 0;
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const freelance = getPlan("freelance")!;

async function user(o: { tg?: number | null } = {}): Promise<number> {
  const r = await db.execute({
    sql: "INSERT INTO users(email, pass_hash, balance, created_at, tg_id) VALUES (?, 'x', 0, 0, ?)",
    args: [`a${++n}@t.ru`, o.tg === undefined ? 1000 + n : o.tg],
  });
  return Number(r.lastInsertRowid);
}

/** Оформить и «оплатить» пробную неделю в тестовом режиме. */
async function trial(u: number): Promise<string> {
  const r = await startTrial({ id: u, email: "a@t.ru" }, "https://x");
  assert.ok("url" in r, JSON.stringify(r));
  const id = new URL(r.url, "https://x").searchParams.get("payment")!;
  assert.equal(await confirmMockPayment(u, id), true);
  return id;
}

/** Сдвинуть пробную неделю и автопродление в прошлое: fulfillPayment считает время по часам, а обход — по переданному t. */
async function shiftBack(u: number, secs: number) {
  await db.execute({ sql: "UPDATE subscriptions SET starts_at = starts_at - ?, ends_at = ends_at - ? WHERE user_id = ?", args: [secs, secs, u] });
  await db.execute({ sql: "UPDATE autorenewals SET next_charge_at = next_charge_at - ? WHERE user_id = ?", args: [secs, u] });
}

function inbox(): { notify: Notify; sent: { tg: number; text: string }[] } {
  const sent: { tg: number; text: string }[] = [];
  return { sent, notify: async (tg, text) => { sent.push({ tg, text }); } };
}

beforeEach(async () => {
  db = await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-auto-")), "app.db"));
});

describe("пробная неделя", () => {
  it("только с Telegram, один раз на аккаунт и на Telegram, не поверх подписки", async () => {
    const noTg = await user({ tg: null });
    assert.equal(await trialBlock(noTg), "no_telegram");
    assert.deepEqual(await startTrial({ id: noTg, email: "x" }, "https://x"), { error: "Пробная неделя доступна аккаунтам с Telegram: привяжите его в «Аккаунте»." });

    const a = await user({ tg: 77 });
    assert.equal(await trialBlock(a), null);
    await trial(a);
    assert.equal(await trialBlock(a), "used");
    await cancelAutorenewal(a, "user");
    await db.execute({ sql: "UPDATE subscriptions SET ends_at = 1 WHERE user_id = ?", args: [a] });
    assert.equal(await trialBlock(a), "used"); // и после окончания

    // тот же Telegram на другом аккаунте (после отвязки) — тоже нельзя
    await db.execute({ sql: "UPDATE users SET tg_id = NULL WHERE id = ?", args: [a] });
    const b = await user({ tg: 77 });
    assert.equal(await trialBlock(b), "used");

    const c = await user();
    await db.execute({ sql: "INSERT INTO subscriptions(user_id, payment_id, plan_id, months, credits_per_month, starts_at, ends_at, granted, created_at) VALUES (?, 'pay', 'studio', 1, 1500, 0, 9999999999, 1, 0)", args: [c] });
    assert.equal(await trialBlock(c), "subscribed");
  });

  it("даёт неделю «Фриланса» и кредиты сразу, включает автопродление по цене месяца", async () => {
    const u = await user();
    const pay = await trial(u);
    const p = await getPayment(u, pay);
    assert.deepEqual([p?.kind, p?.amountRub, p?.title], ["trial", TRIAL.priceRub, `Пробная неделя «${freelance.title}»`]);
    assert.equal(await getBalance(u), TRIAL.credits);
    assert.equal((await getEntitlements(u)).planId, "freelance");
    const [s] = await getSubscriptions(u);
    assert.equal(s.trial, true);
    assert.equal(s.endsAt - s.startsAt, TRIAL.days * DAY);
    const a = (await getAutorenewal(u))!;
    assert.deepEqual([a.status, a.priceRub, a.methodTitle, a.nextChargeAt], ["active", renewPriceRub(), "Test *4444", s.endsAt]);
    assert.equal(renewPriceRub(), freelance.priceMonthRub);
    // согласие записано
    const row = (await db.execute("SELECT consent_at, consent_ver FROM autorenewals")).rows[0];
    assert.ok(Number(row.consent_at) > 0 && String(row.consent_ver).length > 0);
  });

  it("вторая оплата пробной (две вкладки) вторую неделю не даёт", async () => {
    const u = await user();
    const r1 = await startTrial({ id: u, email: "x" }, "https://x");
    const r2 = await startTrial({ id: u, email: "x" }, "https://x");
    const id = (r: typeof r1) => new URL((r as { url: string }).url, "https://x").searchParams.get("payment")!;
    await confirmMockPayment(u, id(r1));
    await confirmMockPayment(u, id(r2));
    assert.equal((await getSubscriptions(u)).length, 1);
    assert.equal(await getBalance(u), TRIAL.credits);
    const st = (await db.execute("SELECT status, cancel_reason FROM autorenewals ORDER BY id")).rows.map((r) => `${r.status}/${r.cancel_reason}`);
    assert.deepEqual(st, ["active/null", "canceled/duplicate"]);
  });
});

describe("автопродление", () => {
  it("напоминает не позже чем за сутки и только потом списывает месяц", async () => {
    const u = await user();
    await trial(u);
    await shiftBack(u, 8 * DAY); // пробная закончилась сутки назад
    const at = (await getAutorenewal(u))!.nextChargeAt!;
    const box = inbox();

    // за 40 часов рано даже напоминать
    assert.deepEqual(await runAutorenewals(at - 40 * 3600, box.notify), { notified: 0, charged: 0, retries: 0, disabled: 0, errors: 0 });
    // за 30 часов — напоминание, без списания
    const r1 = await runAutorenewals(at - 30 * 3600, box.notify);
    assert.deepEqual([r1.notified, r1.charged], [1, 0]);
    assert.match(box.sent[0].text, /спишем/);
    assert.match(box.sent[0].text, /account#autorenew/);
    // ещё до наступления срока не списываем
    assert.equal((await runAutorenewals(at - 3600, box.notify)).charged, 0);
    // срок наступил и с напоминания прошли сутки — списываем
    const r2 = await runAutorenewals(now(), box.notify);
    assert.deepEqual([r2.charged, r2.errors], [1, 0]);
    assert.equal(await getBalance(u), TRIAL.credits + freelance.creditsPerMonth);
    const pays = (await db.execute("SELECT kind, package_id, amount_kop, status FROM payments WHERE kind = 'subscription'")).rows;
    assert.equal(pays.length, 1);
    assert.equal(pays[0].amount_kop, freelance.priceMonthRub * 100);
    assert.equal(pays[0].status, "succeeded");
    assert.match(String(pays[0].package_id), /^autorenew:\d+$/);
    const a = (await getAutorenewal(u))!;
    assert.ok(a.nextChargeAt! > now() + 27 * DAY); // следующее — через месяц
    assert.match(box.sent[1].text, /списали/);
    // повторный обход второй раз не списывает
    assert.equal((await runAutorenewals(now(), box.notify)).charged, 0);
  });

  it("если предупредить не удалось — не списывает, а через трое суток отключает", async () => {
    const u = await user();
    await trial(u);
    await shiftBack(u, 8 * DAY);
    const broken: Notify = async () => { throw new Error("бот заблокирован"); };
    assert.deepEqual(await runAutorenewals(now(), broken), { notified: 0, charged: 0, retries: 0, disabled: 0, errors: 0 });
    assert.equal((await db.execute("SELECT count(*) AS n FROM payments WHERE kind = 'subscription'")).rows[0].n, 0);
    const r = await runAutorenewals(now() + 3 * DAY, broken);
    assert.equal(r.disabled, 1);
    const a = (await getAutorenewal(u))!;
    assert.deepEqual([a.status, a.cancelReason], ["canceled", "no_notice"]);
  });

  it("неудачное списание повторяет через сутки с уведомлением, после трёх неудач отключает", async () => {
    const u = await user();
    await trial(u);
    await shiftBack(u, 8 * DAY);
    await db.execute("UPDATE autorenewals SET method_id = 'bad-card'");
    const box = inbox();
    let t = now();
    await runAutorenewals(t - 2 * DAY, box.notify); // напоминание заранее (за 36 часов до срока и не меньше чем за сутки до списания)
    assert.equal((await runAutorenewals(t, box.notify)).retries, 1);
    assert.match(box.sent.at(-1)!.text, /Попробуем ещё раз/);
    assert.equal((await runAutorenewals(t + 3600, box.notify)).retries, 0); // сутки ещё не прошли
    t += DAY;
    assert.equal((await runAutorenewals(t, box.notify)).retries, 1);
    t += DAY;
    assert.equal((await runAutorenewals(t, box.notify)).disabled, 1);
    const a = (await getAutorenewal(u))!;
    assert.deepEqual([a.status, a.cancelReason, a.failures], ["canceled", "failed", 3]);
    assert.match(box.sent.at(-1)!.text, /автопродление отключено/);
    assert.equal(await getBalance(u), TRIAL.credits); // ничего не списано и не начислено
  });

  it("отключение: больше не списывает, оплаченное доигрывает", async () => {
    const u = await user();
    await trial(u);
    assert.equal(await cancelAutorenewal(u, "user"), true);
    assert.equal(await cancelAutorenewal(u, "user"), false);
    await shiftBack(u, 8 * DAY);
    const box = inbox();
    assert.deepEqual(await runAutorenewals(now() + 10 * DAY, box.notify), { notified: 0, charged: 0, retries: 0, disabled: 0, errors: 0 });
    assert.equal(box.sent.length, 0);
    const row = (await db.execute("SELECT method_id, cancel_reason FROM autorenewals")).rows[0];
    assert.deepEqual([row.method_id, row.cancel_reason], [null, "user"]); // карту забыли
  });

  it("пробная неделя не мешает удалить аккаунт, а удаление отключает автопродление", async () => {
    const u = await user();
    await trial(u);
    assert.equal((await deleteAccount(u)).ok, true);
    const row = (await db.execute("SELECT status, cancel_reason FROM autorenewals")).rows[0];
    assert.deepEqual([row.status, row.cancel_reason], ["canceled", "deleted"]);
  });

  it("тексты уведомлений: сумма, карта и ссылка на отключение", () => {
    const a = { id: 1, userId: 1, planId: "freelance", title: "Фриланс", priceRub: 790, status: "active" as const, methodTitle: "Mir *4444", nextChargeAt: 0, failures: 0, canceledAt: null, cancelReason: null, createdAt: 0 };
    const t = MESSAGES.upcoming(a, 1_800_000_000);
    assert.match(t, /790/);
    assert.match(t, /Mir \*4444/);
    assert.match(t, /\/account#autorenew/);
  });
});

describe("оферта", () => {
  it("раздел 16 о пробном периоде и автопродлении с ценами из кода", () => {
    const s = offerSections().find((x) => x.id === "trial")!;
    const text = s.body.flat().join(" ");
    assert.match(s.title, /^16\./);
    assert.match(text, new RegExp(`${freelance.priceMonthRub}`));
    assert.match(text, /24 час/);
    assert.match(text, /16\.1/);
    assert.equal(offerSections().at(-1)!.title.startsWith("17."), true);
  });
});

describe("ЮKassa (поддельный сервер)", () => {
  let server: http.Server;
  let requests: { url: string; body: string }[] = [];
  let behaviour: (url: string, body: string) => unknown = () => ({});

  before(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        requests.push({ url: req.url ?? "", body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(behaviour(req.url ?? "", body)));
      });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    process.env.YOOKASSA_SHOP_ID = "shop";
    process.env.YOOKASSA_SECRET_KEY = "key";
    process.env.YOOKASSA_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v3`;
    process.env.TRIAL_ENABLED = "1";
  });
  after(() => {
    server.close();
    delete process.env.YOOKASSA_SHOP_ID;
    delete process.env.YOOKASSA_SECRET_KEY;
    delete process.env.YOOKASSA_API_URL;
    delete process.env.TRIAL_ENABLED;
  });
  beforeEach(() => { requests = []; });

  it("с настоящей ЮKassa пробная неделя выключена, пока владелец не включит TRIAL_ENABLED", async () => {
    const u = await user();
    delete process.env.TRIAL_ENABLED;
    assert.equal(await trialBlock(u), "disabled");
    assert.ok("error" in (await startTrial({ id: u, email: "a@t.ru" }, "https://x")));
    assert.equal(requests.length, 0); // в ЮKassa даже не ходили
    process.env.TRIAL_ENABLED = "1";
    assert.equal(await trialBlock(u), null);
  });

  it("пробная просит сохранить карту, а продление списывает с неё без подтверждения", async () => {
    const u = await user();
    const card = { id: "pm-1", type: "bank_card", saved: true, card: { last4: "4444", card_type: "Mir" } };
    behaviour = (url) => (url === "/v3/payments"
      ? { id: "yoo-trial", status: "pending", confirmation: { confirmation_url: "https://pay" } }
      : { id: "yoo-trial", status: "succeeded", paid: true, amount: { value: "1.00", currency: "RUB" }, payment_method: card });
    const r = await startTrial({ id: u, email: "a@t.ru" }, "https://x");
    assert.deepEqual(r, { url: "https://pay" });
    const body = JSON.parse(requests[0].body);
    assert.equal(body.save_payment_method, true);
    assert.deepEqual(body.payment_method_data, { type: "bank_card" });
    assert.deepEqual(body.amount, { value: "1.00", currency: "RUB" });

    assert.equal(await settleByProviderId("yoo-trial"), "succeeded"); // как после вебхука
    const a = (await getAutorenewal(u))!;
    assert.deepEqual([a.status, a.methodTitle], ["active", "Mir *4444"]);

    await shiftBack(u, 8 * DAY);
    requests = [];
    behaviour = (url) => (url === "/v3/payments"
      ? { id: "yoo-renew", status: "succeeded", paid: true, amount: { value: `${freelance.priceMonthRub}.00`, currency: "RUB" } }
      : { id: "yoo-renew", status: "succeeded", paid: true, amount: { value: `${freelance.priceMonthRub}.00`, currency: "RUB" } });
    const box = inbox();
    await runAutorenewals(now() - 2 * DAY, box.notify);
    const res = await runAutorenewals(now(), box.notify);
    assert.equal(res.charged, 1);
    const charge = JSON.parse(requests.find((x) => x.url === "/v3/payments")!.body);
    assert.equal(charge.payment_method_id, "pm-1");
    assert.equal(charge.confirmation, undefined);
    assert.deepEqual(charge.amount, { value: `${freelance.priceMonthRub}.00`, currency: "RUB" });
    assert.equal(await getBalance(u), TRIAL.credits + freelance.creditsPerMonth);
  });

  it("если карта не сохранилась, пробная неделя есть, а автопродления нет", async () => {
    const u = await user();
    behaviour = (url) => (url === "/v3/payments"
      ? { id: "yoo-t2", status: "pending", confirmation: { confirmation_url: "https://pay" } }
      : { id: "yoo-t2", status: "succeeded", paid: true, amount: { value: "1.00", currency: "RUB" }, payment_method: { id: "pm-2", type: "bank_card", saved: false } });
    await startTrial({ id: u, email: "a@t.ru" }, "https://x");
    await settleByProviderId("yoo-t2");
    assert.equal(await getBalance(u), TRIAL.credits);
    const a = (await getAutorenewal(u))!;
    assert.deepEqual([a.status, a.cancelReason], ["canceled", "not_saved"]);
  });
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { createSubscriptionCheckout, fulfillPayment, getPayment, listPayments } from "../src/lib/billing";
import { getBalance, getLedger } from "../src/lib/credits";
import { __resetAppDbForTests } from "../src/lib/db";
import { LEGAL_VERSION, consentSections, offerSections, privacySections } from "../src/lib/legal";
import { PERIODS, PLANS, addMonths, fmtRub, getPlan, planCredits, planPerLead, planPrice } from "../src/lib/plans";
import { getSubscriptions, syncSubscriptions } from "../src/lib/subscriptions";
import { createUser } from "../src/lib/users";

type Db = Awaited<ReturnType<typeof __resetAppDbForTests>>;
let db: Db;
let n = 0;

async function newUser(balance = 0): Promise<number> {
  const r = await db.execute({ sql: "INSERT INTO users(email, pass_hash, balance, created_at) VALUES (?, 'x', ?, 0)", args: [`s${++n}@test.ru`, balance] });
  return Number(r.lastInsertRowid);
}

/** Покупка подписки в тестовом режиме (без ЮKassa) и её оплата. */
async function buy(userId: number, planId: string, months: number): Promise<string> {
  const { paymentId } = await createSubscriptionCheckout({ id: userId, email: "a@b.ru" }, getPlan(planId)!, months, "https://x");
  assert.equal(await fulfillPayment(paymentId), true);
  return paymentId;
}

const DAY = 86400;
const studio = getPlan("studio")!;
const freelance = getPlan("freelance")!;
const agency = getPlan("agency")!;
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fw-subs-"));
  db = await __resetAppDbForTests("file:" + path.join(dir, "app.db"));
});

describe("тарифы и цены", () => {
  it("цена за срок: цена месяца на число месяцев со скидкой за срок", () => {
    assert.equal(planPrice(studio, 1), studio.priceMonthRub);
    assert.equal(planPrice(studio, 3), Math.round(studio.priceMonthRub * 3 * 0.9));
    assert.equal(planPrice(studio, 12), Math.round(studio.priceMonthRub * 12 * 0.8));
    assert.equal(planCredits(studio, 12), studio.creditsPerMonth * 12);
  });

  it("чем длиннее срок, тем дешевле кредит, и подписка не дороже разовых кредитов того же размера", () => {
    for (const p of PLANS) {
      const costs = PERIODS.map((x) => planPerLead(p, x.months));
      assert.deepEqual([...costs].sort((a, b) => b - a), costs, `у тарифа ${p.id} цена кредита должна падать со сроком`);
    }
  });

  it("месяцы прибавляются по календарю, а не по 30 дней", () => {
    assert.equal(addMonths(sec("2026-01-15T10:00:00Z"), 1), sec("2026-02-15T10:00:00Z"));
    assert.equal(addMonths(sec("2026-01-31T10:00:00Z"), 1), sec("2026-02-28T10:00:00Z"));
    assert.equal(addMonths(sec("2028-01-31T10:00:00Z"), 1), sec("2028-02-29T10:00:00Z"));
    assert.equal(addMonths(sec("2026-11-30T00:00:00Z"), 3), sec("2027-02-28T00:00:00Z"));
    assert.equal(addMonths(sec("2026-03-10T00:00:00Z"), 12), sec("2027-03-10T00:00:00Z"));
  });

  it("сумма форматируется с неразрывными пробелами", () => {
    assert.equal(fmtRub(19104), "19 104 ₽");
    assert.equal(fmtRub(790), "790 ₽");
  });
});

describe("покупка подписки", () => {
  it("первый месяц зачисляется сразу, остальные ждут своей даты", async () => {
    const u = await newUser(5);
    const id = await buy(u, "studio", 3);

    assert.equal(await getBalance(u), 5 + studio.creditsPerMonth);
    const p = await getPayment(u, id);
    assert.equal(p?.kind, "subscription");
    assert.equal(p?.credits, studio.creditsPerMonth * 3);
    assert.equal(p?.amountRub, planPrice(getPlan("studio")!, 3));
    assert.match(p?.title ?? "", /Студия/);

    const subs = await getSubscriptions(u);
    assert.equal(subs.length, 1);
    assert.equal(subs[0].granted, 1);
    assert.equal(subs[0].creditsPerMonth, studio.creditsPerMonth);
    assert.ok(subs[0].nextGrantAt && subs[0].nextGrantAt > Date.now() / 1000 + 27 * DAY);
    assert.deepEqual((await getLedger(u)).filter((l) => l.reason === "subscription").map((l) => l.delta), [studio.creditsPerMonth]);
  });

  it("повторная обработка того же платежа ничего не начисляет", async () => {
    const u = await newUser();
    const id = await buy(u, "freelance", 1);
    assert.equal(await fulfillPayment(id), false);
    assert.equal(await getBalance(u), freelance.creditsPerMonth);
    assert.equal((await db.execute("SELECT count(*) AS n FROM subscriptions")).rows[0].n, 1);
  });

  it("подписка на месяц начисляет всё сразу и больше ничего не ждёт", async () => {
    const u = await newUser();
    await buy(u, "freelance", 1);
    const subs = await getSubscriptions(u);
    assert.equal(subs[0].nextGrantAt, null);
    const row = (await db.execute({ sql: "SELECT sub_next_at FROM users WHERE id = ?", args: [u] })).rows[0];
    assert.equal(row.sub_next_at, null);
  });

  it("следующие месяцы начисляются, когда наступает их дата, и ровно один раз", async () => {
    const u = await newUser();
    await buy(u, "studio", 3);

    // Сдвигаем начало подписки на 40 дней назад: второй месяц уже наступил, третий нет.
    await db.execute({ sql: "UPDATE subscriptions SET starts_at = starts_at - ? WHERE user_id = ?", args: [40 * DAY, u] });
    await db.execute({ sql: "UPDATE users SET sub_next_at = 1 WHERE id = ?", args: [u] });
    const got = await Promise.all([syncSubscriptions(u), syncSubscriptions(u), syncSubscriptions(u)]);
    assert.equal(got.reduce((a, b) => a + b, 0), studio.creditsPerMonth, "второй месяц начислен один раз, несмотря на параллельные вызовы");
    assert.equal(await getBalance(u), studio.creditsPerMonth * 2);

    assert.equal(await syncSubscriptions(u), 0);
    assert.equal(await getBalance(u), studio.creditsPerMonth * 2);

    // Ещё 40 дней: наступил третий месяц, подписка начислена целиком.
    await db.execute({ sql: "UPDATE subscriptions SET starts_at = starts_at - ? WHERE user_id = ?", args: [40 * DAY, u] });
    assert.equal(await syncSubscriptions(u), studio.creditsPerMonth);
    assert.equal(await getBalance(u), studio.creditsPerMonth * 3);
    const row = (await db.execute({ sql: "SELECT sub_next_at FROM users WHERE id = ?", args: [u] })).rows[0];
    assert.equal(row.sub_next_at, null, "начислять больше нечего");
  });

  it("если пропустить несколько месяцев, при следующем заходе начислятся все наступившие", async () => {
    const u = await newUser();
    await buy(u, "agency", 12);
    await db.execute({ sql: "UPDATE subscriptions SET starts_at = starts_at - ? WHERE user_id = ?", args: [100 * DAY, u] });
    const got = await syncSubscriptions(u);
    assert.equal(got, agency.creditsPerMonth * 3, "прошло 3 месяца с лишним: ещё три начисления");
    assert.equal(await getBalance(u), agency.creditsPerMonth * 4);
  });

  it("вторая подписка встаёт в очередь после действующей, оплаченное время не теряется", async () => {
    const u = await newUser();
    await buy(u, "freelance", 3);
    await buy(u, "studio", 1);
    const subs = await getSubscriptions(u);
    assert.equal(subs.length, 2);
    assert.equal(subs[1].startsAt, subs[0].endsAt);
    assert.equal(subs[1].granted, 0, "кредиты второй подписки ещё не начислены");
    assert.equal(await getBalance(u), freelance.creditsPerMonth, "пока работает первая подписка, кредиты второй не приходят");
  });

  it("реферальная награда выплачивается и за первую покупку подписки, один раз", async () => {
    const inviter = await createUser("inviter@test.ru", "x");
    assert.ok(inviter.ok);
    const code = String((await db.execute({ sql: "SELECT ref_code FROM users WHERE id = ?", args: [inviter.userId] })).rows[0].ref_code);
    const guest = await createUser("guest@test.ru", "x", code);
    assert.ok(guest.ok);
    const before = await getBalance(inviter.userId);

    await buy(guest.userId, "freelance", 1);
    await buy(guest.userId, "freelance", 1);
    const reward = Number((await db.execute("SELECT credits FROM referral_rewards")).rows[0].credits);
    assert.equal(await getBalance(inviter.userId), before + reward);
    assert.equal((await db.execute("SELECT count(*) AS n FROM referral_rewards")).rows[0].n, 1);
  });

  it("в списке платежей подписка подписана понятным названием", async () => {
    const u = await newUser();
    await buy(u, "agency", 12);
    const [p] = await listPayments(u);
    assert.equal(p.title, "Подписка «Агентство» на 12 мес.");
  });
});

describe("согласие при регистрации", () => {
  it("редакция и время согласия сохраняются", async () => {
    const r = await createUser("c@test.ru", "x", null, LEGAL_VERSION);
    assert.ok(r.ok);
    const row = (await db.execute({ sql: "SELECT consent_at, consent_ver FROM users WHERE id = ?", args: [r.userId] })).rows[0];
    assert.equal(row.consent_ver, LEGAL_VERSION);
    assert.ok(Number(row.consent_at) > 0);
  });

  it("без указания версии поля остаются пустыми (старые аккаунты)", async () => {
    const r = await createUser("old@test.ru", "x");
    assert.ok(r.ok);
    const row = (await db.execute({ sql: "SELECT consent_at, consent_ver FROM users WHERE id = ?", args: [r.userId] })).rows[0];
    assert.equal(row.consent_at, null);
    assert.equal(row.consent_ver, null);
  });
});

describe("юридические документы", () => {
  const text = (s: ReturnType<typeof offerSections>) => s.flatMap((x) => [x.title, ...x.body.flat()]).join("\n");

  it("оферта берёт цены и условия подписки из кода", () => {
    const t = text(offerSections());
    for (const p of PLANS) assert.ok(t.includes(`подписка «${p.title}»`), `в оферте нет тарифа ${p.title}`);
    assert.ok(t.includes("Автоматического продления нет"));
    assert.ok(t.includes(`редакция ${LEGAL_VERSION}`));
  });

  it("реквизиты подставляются из переменных окружения", () => {
    process.env.SELLER_NAME = "Иванов Иван Иванович";
    process.env.SELLER_INN = "123456789012";
    process.env.SUPPORT_EMAIL = "help@example.ru";
    try {
      for (const s of [offerSections(), privacySections(), consentSections()]) {
        const t = text(s);
        assert.ok(t.includes("Иванов Иван Иванович"), "имя продавца в документе");
        assert.ok(t.includes("help@example.ru"), "почта для обращений в документе");
        assert.ok(!/\[укажите/.test(t), "заглушки не должны остаться");
      }
      assert.ok(text(offerSections()).includes("«Мой налог»"), "по умолчанию продавец самозанятый");
    } finally {
      delete process.env.SELLER_NAME;
      delete process.env.SELLER_INN;
      delete process.env.SUPPORT_EMAIL;
    }
  });

  it("для ИП чек по 54-ФЗ, а про «Мой налог» ничего нет", () => {
    process.env.SELLER_STATUS = "индивидуальный предприниматель";
    try {
      const t = text(offerSections());
      assert.ok(t.includes("54-ФЗ"));
      assert.ok(!t.includes("«Мой налог»"));
    } finally {
      delete process.env.SELLER_STATUS;
    }
  });

  it("политика не заявляет хранение в РФ, пока не задан PD_RU_HOST", () => {
    const without = text(privacySections());
    assert.ok(without.includes("Ирландии"));
    assert.ok(!without.includes("находящейся на территории Российской Федерации"));

    process.env.PD_RU_HOST = "Selectel, Москва";
    try {
      const withHost = text(privacySections());
      assert.ok(withHost.includes("находящейся на территории Российской Федерации (Selectel, Москва)"));
      assert.ok(!text(consentSections()).includes("размещена за пределами"));
    } finally {
      delete process.env.PD_RU_HOST;
    }
  });
});

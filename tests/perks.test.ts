import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { createCheckout, createSubscriptionCheckout, fulfillPayment, getPackage, getPayment, packagePrice } from "../src/lib/billing";
import { activeClaimCount, claimLead, claimedByOthers, getClaimInfo, releaseClaim } from "../src/lib/claims";
import { SIGNUP_BONUS, getBalance, getLedger, unlockLead, unlockMany } from "../src/lib/credits";
import { __resetAppDbForTests } from "../src/lib/db";
import { entitlementsAt, getEntitlements } from "../src/lib/entitlements";
import { consentSections, offerSections, privacySections } from "../src/lib/legal";
import { BASE_PERKS, EXCLUSIVE_COST, EXCLUSIVE_DAYS, PLANS, REPORT_COST, getPlan } from "../src/lib/plans";
import { cleanProfile, createReport, getPublicReport, isReportOwner, listReports, reportQuota, revokeReport } from "../src/lib/reports";
import { createUser } from "../src/lib/users";

type Db = Awaited<ReturnType<typeof __resetAppDbForTests>>;
let db: Db;
let n = 0;
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

async function newUser(balance = 0): Promise<number> {
  const r = await db.execute({ sql: "INSERT INTO users(email, pass_hash, balance, created_at) VALUES (?, 'x', ?, 0)", args: [`p${++n}@test.ru`, balance] });
  return Number(r.lastInsertRowid);
}

async function subscribe(userId: number, planId: string, months = 1): Promise<void> {
  const { paymentId } = await createSubscriptionCheckout({ id: userId, email: "a@b.ru" }, getPlan(planId)!, months, "https://x");
  assert.equal(await fulfillPayment(paymentId), true);
}

const profile = { name: "Алексей", contact: "@alexey", skills: "Лендинги", portfolio: "https://alexey.dev", priceFrom: "15 000 ₽" };
const findings = [{ level: "bad" as const, text: "Сайт не открывается с телефона" }, { level: "ok" as const, text: "Есть HTTPS" }];
const report = (u: number, leadId = "lead-1") => createReport(u, { leadId, leadName: "Студия «Лотос»", siteUrl: "https://lotos.example", findings, profile: cleanProfile(profile) });

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fw-perks-"));
  db = await __resetAppDbForTests("file:" + path.join(dir, "app.db"));
});

describe("права по подписке", () => {
  it("без подписки действуют базовые права", async () => {
    const u = await newUser();
    const e = await getEntitlements(u);
    assert.equal(e.planId, null);
    assert.equal(e.exclusiveSlots, 0);
    assert.equal(e.reportsPer30d, 0);
    assert.equal(e.packageDiscountPct, 0);
    assert.equal(e.referralMultiplier, 1);
    assert.equal(e.pitchesPerHour, BASE_PERKS.pitchesPerHour);
  });

  it("действующая подписка даёт права своего тарифа", async () => {
    const u = await newUser();
    await subscribe(u, "studio");
    const e = await getEntitlements(u);
    const p = getPlan("studio")!;
    assert.equal(e.planId, "studio");
    assert.equal(e.exclusiveSlots, p.perks.exclusiveSlots);
    assert.equal(e.packageDiscountPct, p.perks.packageDiscountPct);
    assert.equal(e.referralMultiplier, p.perks.referralMultiplier);
    assert.equal(e.pitchesPerHour, p.perks.pitchesPerHour);
  });

  it("не начавшаяся и закончившаяся подписки прав не дают", async () => {
    const u = await newUser();
    await subscribe(u, "freelance", 1);
    await subscribe(u, "agency", 1); // встала в очередь после первой
    const t = now();
    assert.equal((await entitlementsAt(db, u, t)).planId, "freelance", "пока идёт первая, права первой");
    const second = (await db.execute({ sql: "SELECT starts_at FROM subscriptions WHERE plan_id = 'agency'" })).rows[0];
    assert.equal((await entitlementsAt(db, u, Number(second.starts_at) + 5)).planId, "agency", "началась вторая");
    assert.equal((await entitlementsAt(db, u, t + 90 * DAY)).planId, null, "всё закончилось");
  });

  it("подписка не опускает лимит питчей ниже базового, а переменная его меняет", async () => {
    const keep = process.env.PITCH_HOURLY_LIMIT;
    try {
      process.env.PITCH_HOURLY_LIMIT = "1000";
      const u = await newUser();
      await subscribe(u, "freelance");
      assert.equal((await getEntitlements(u)).pitchesPerHour, 1000);
      process.env.PITCH_HOURLY_LIMIT = "20";
      assert.equal((await getEntitlements(u)).pitchesPerHour, getPlan("freelance")!.perks.pitchesPerHour);
    } finally {
      if (keep === undefined) delete process.env.PITCH_HOURLY_LIMIT; else process.env.PITCH_HOURLY_LIMIT = keep;
    }
  });

  it("чем старше тариф, тем больше прав", () => {
    for (let i = 1; i < PLANS.length; i++) {
      const a = PLANS[i - 1].perks, b = PLANS[i].perks;
      assert.ok(b.exclusiveSlots > a.exclusiveSlots && b.reportsPer30d > a.reportsPer30d && b.packageDiscountPct > a.packageDiscountPct);
      assert.ok(b.referralMultiplier >= a.referralMultiplier && b.pitchesPerHour > a.pitchesPerHour);
    }
  });
});

describe("эксклюзив на заведение", () => {
  it("без подписки и без открытого заведения взять нельзя", async () => {
    const u = await newUser(50);
    await unlockLead(u, "L1");
    assert.deepEqual(await claimLead(u, "L1"), { ok: false, reason: "no_plan" });
    await subscribe(u, "freelance");
    assert.deepEqual(await claimLead(u, "L2"), { ok: false, reason: "not_opened" });
  });

  it("берётся за кредиты на 30 дней и записывается в историю", async () => {
    const u = await newUser(50);
    await subscribe(u, "freelance");
    await unlockLead(u, "L1");
    const before = await getBalance(u);
    const t = now();
    const r = await claimLead(u, "L1");
    assert.ok(r.ok);
    assert.ok(Math.abs(r.until - (t + EXCLUSIVE_DAYS * DAY)) < 5);
    assert.equal(await getBalance(u), before - EXCLUSIVE_COST);
    assert.equal(r.balance, before - EXCLUSIVE_COST);
    const led = (await getLedger(u)).find((l) => l.reason === "exclusive");
    assert.deepEqual([led?.delta, led?.ref], [-EXCLUSIVE_COST, "L1"]);
    assert.equal(await activeClaimCount(u), 1);
  });

  it("чужой эксклюзив не даёт открыть заведение, не списывая кредиты", async () => {
    const owner = await newUser(50), guest = await newUser(10);
    await subscribe(owner, "freelance");
    await unlockLead(owner, "L1");
    assert.ok((await claimLead(owner, "L1")).ok);

    const before = await getBalance(guest);
    const r = await unlockLead(guest, "L1");
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.reason === "claimed" && r.until > now());
    assert.equal(await getBalance(guest), before);
    assert.equal((await getLedger(guest)).filter((l) => l.reason === "unlock").length, 0);
    // Свой эксклюзив владельцу не мешает.
    assert.deepEqual(await unlockLead(owner, "L1"), { ok: true, charged: 0, balance: await getBalance(owner) });
  });

  it("кто открыл заведение до эксклюзива, доступ сохраняет", async () => {
    const early = await newUser(5), owner = await newUser(50);
    await unlockLead(early, "L1");
    await unlockLead(owner, "L1");
    await subscribe(owner, "studio");
    assert.ok((await claimLead(owner, "L1")).ok);
    assert.deepEqual(await unlockLead(early, "L1"), { ok: true, charged: 0, balance: 4 });
    const info = await getClaimInfo(owner, "L1");
    assert.equal(info.othersOpened, 1);
    assert.ok(info.mine && !info.other);
    const seen = await getClaimInfo(early, "L1");
    assert.ok(seen.other && !seen.mine);
  });

  it("пачка пропускает заведения в чужом эксклюзиве и платит только за остальные", async () => {
    const owner = await newUser(50), guest = await newUser(10);
    await subscribe(owner, "freelance");
    await unlockLead(owner, "L1");
    await claimLead(owner, "L1");
    const r = await unlockMany(guest, ["L1", "L2", "L3"]);
    assert.deepEqual(r, { ok: true, opened: 2, charged: 2, balance: 8, skipped: 1 });
    const all = await unlockMany(guest, ["L1"]);
    assert.deepEqual(all, { ok: true, opened: 0, charged: 0, balance: 8, skipped: 1 });
  });

  it("ограничения: свой повтор, чужой занят, места тарифа, кредиты", async () => {
    const a = await newUser(100), b = await newUser(100), poor = await newUser(0);
    await subscribe(a, "freelance"); await subscribe(b, "freelance"); await subscribe(poor, "freelance");
    for (const u of [a, b]) await unlockLead(u, "L1");
    assert.ok((await claimLead(a, "L1")).ok);
    assert.ok((await claimLead(a, "L1") as { reason: string }).reason === "mine");
    assert.ok((await claimLead(b, "L1") as { reason: string }).reason === "taken");

    // Места тарифа: у «Фриланса» их 5.
    const slots = getPlan("freelance")!.perks.exclusiveSlots;
    for (let i = 0; i < slots - 1; i++) { await unlockLead(a, `M${i}`); assert.ok((await claimLead(a, `M${i}`)).ok); }
    await unlockLead(a, "EXTRA");
    assert.deepEqual(await claimLead(a, "EXTRA"), { ok: false, reason: "no_slots", slots });
    assert.ok(await releaseClaim(a, "M0"), "отпустили одно");
    assert.ok((await claimLead(a, "EXTRA")).ok, "слот освободился");

    await unlockLead(poor, "P1");
    await db.execute({ sql: "UPDATE users SET balance = 0 WHERE id = ?", args: [poor] });
    assert.deepEqual(await claimLead(poor, "P1"), { ok: false, reason: "insufficient", balance: 0 });
  });

  it("закончившийся эксклюзив открывает заведение другим", async () => {
    const owner = await newUser(50), guest = await newUser(10);
    await subscribe(owner, "freelance");
    await unlockLead(owner, "L1");
    await claimLead(owner, "L1");
    await db.execute({ sql: "UPDATE lead_claims SET until = ? WHERE lead_id = 'L1'", args: [now() - 1] });
    assert.equal((await claimedByOthers(db, guest, ["L1"])).size, 0);
    assert.ok((await unlockLead(guest, "L1")).ok);
    assert.equal(await activeClaimCount(owner), 0);
  });

  it("два подписчика одновременно: эксклюзив получает один", async () => {
    const a = await newUser(50), b = await newUser(50);
    for (const u of [a, b]) { await subscribe(u, "studio"); await unlockLead(u, "HOT"); }
    const res = await Promise.all([claimLead(a, "HOT"), claimLead(b, "HOT")]);
    assert.equal(res.filter((r) => r.ok).length, 1);
    assert.equal((await db.execute("SELECT count(*) AS n FROM lead_claims")).rows[0].n, 1);
    const loser = res.find((r) => !r.ok) as { reason: string };
    assert.equal(loser.reason, "taken");
  });

  it("отпускание эксклюзива не возвращает кредиты", async () => {
    const u = await newUser(50);
    await subscribe(u, "freelance");
    await unlockLead(u, "L1");
    await claimLead(u, "L1");
    const mid = await getBalance(u);
    assert.equal(await releaseClaim(u, "L1"), true);
    assert.equal(await getBalance(u), mid);
    assert.equal(await releaseClaim(u, "L1"), false);
  });
});

describe("отчёт для клиента", () => {
  it("профиль чистится: портфолио только ссылкой, лишнее обрезается", () => {
    const p = cleanProfile({ name: "  Алексей\n", contact: "x".repeat(500), portfolio: "javascript:alert(1)", skills: 5, priceFrom: "от 1 ₽" });
    assert.equal(p.name, "Алексей");
    assert.equal(p.contact.length, 120);
    assert.equal(p.portfolio, "");
    assert.equal(p.skills, "");
    assert.equal(cleanProfile({ portfolio: "https://a.b/c" }).portfolio, "https://a.b/c");
  });

  it("без имени или контакта отчёт не создаётся", async () => {
    const u = await newUser(10);
    const r = await createReport(u, { leadId: "L", leadName: "X", siteUrl: "https://x.ru", findings, profile: cleanProfile({ name: "A" }) });
    assert.ok(!r.ok && r.reason === "profile");
  });

  it("без подписки отчёт стоит кредит, при нуле на балансе отказ", async () => {
    const u = await newUser(1);
    const r = await report(u);
    assert.ok(r.ok && r.charged === REPORT_COST && r.balance === 1 - REPORT_COST);
    assert.equal((await getLedger(u)).find((l) => l.reason === "report")?.delta, -REPORT_COST);
    const again = await report(u, "lead-2");
    assert.deepEqual(again, { ok: false, reason: "insufficient", balance: 0 });
  });

  it("по подписке отчёты входят в квоту, сверх неё платные", async () => {
    const u = await newUser(0);
    await subscribe(u, "freelance");
    const quota = getPlan("freelance")!.perks.reportsPer30d;
    const bal = await getBalance(u);
    for (let i = 0; i < quota; i++) {
      const r = await report(u, `lead-${i}`);
      assert.ok(r.ok && r.charged === 0, `отчёт ${i + 1} входит в тариф`);
    }
    assert.equal(await getBalance(u), bal);
    const q = await reportQuota(u);
    assert.deepEqual([q.included, q.used, q.left], [quota, quota, 0]);
    const over = await report(u, "lead-over");
    assert.ok(over.ok && over.charged === REPORT_COST);
    assert.equal(await getBalance(u), bal - REPORT_COST);
  });

  it("публичная страница: просмотры считаются, автор не считается, чужие данные не видны", async () => {
    const u = await newUser(5);
    const r = await report(u);
    assert.ok(r.ok);
    const first = await getPublicReport(r.token);
    assert.ok(first && first.state === "ok");
    if (first.state === "ok") {
      assert.equal(first.leadName, "Студия «Лотос»");
      assert.equal(first.profile.contact, "@alexey");
      assert.equal(first.findings.length, 2);
    }
    await getPublicReport(r.token);
    await getPublicReport(r.token, false);
    const [row] = await listReports(u, "lead-1");
    assert.equal(row.views, 2);
    assert.equal(await isReportOwner(u, r.token), true);
    assert.equal(await isReportOwner(u + 1, r.token), false);
    assert.equal(await getPublicReport("short"), null);
    assert.equal(await getPublicReport("A".repeat(24)), null);
  });

  it("срок, отзыв и удаление старых", async () => {
    const u = await newUser(10), other = await newUser(10);
    const a = await report(u, "A"), b = await report(u, "B");
    assert.ok(a.ok && b.ok);

    assert.equal(await revokeReport(other, a.token), false, "чужой отозвать не может");
    assert.equal(await revokeReport(u, a.token), true);
    assert.deepEqual(await getPublicReport(a.token), { state: "revoked" });

    await db.execute({ sql: "UPDATE audit_reports SET expires_at = ? WHERE token = ?", args: [now() - 10, b.token] });
    assert.deepEqual(await getPublicReport(b.token), { state: "expired" });

    await db.execute({ sql: "UPDATE audit_reports SET expires_at = ? WHERE token = ?", args: [now() - 61 * DAY, b.token] });
    await report(u, "C"); // создание нового чистит давно истёкшие
    assert.equal(await getPublicReport(b.token), null);
  });
});

describe("скидка подписчикам и награда за приглашённых", () => {
  it("подписчик докупает пакет со скидкой, остальные по полной цене", async () => {
    const pkg = getPackage("s400")!;
    const plain = await newUser(), sub = await newUser();
    await subscribe(sub, "studio");
    const a = await createCheckout({ id: plain, email: "a@b.ru" }, pkg, "https://x");
    const b = await createCheckout({ id: sub, email: "a@b.ru" }, pkg, "https://x");
    assert.equal((await getPayment(plain, a.paymentId))?.amountRub, pkg.priceRub);
    const d = getPlan("studio")!.perks.packageDiscountPct;
    assert.equal((await getPayment(sub, b.paymentId))?.amountRub, packagePrice(pkg, d));
    assert.ok(packagePrice(pkg, d) < pkg.priceRub);
    assert.equal((await getPayment(sub, b.paymentId))?.credits, pkg.credits, "кредитов столько же");
  });

  it("пригласивший с подпиской получает награду с множителем тарифа", async () => {
    const plain = await createUser("plain@test.ru", "x"), sub = await createUser("sub@test.ru", "x");
    assert.ok(plain.ok && sub.ok);
    await subscribe(sub.userId, "studio");
    const code = async (id: number) => String((await db.execute({ sql: "SELECT ref_code FROM users WHERE id = ?", args: [id] })).rows[0].ref_code);
    const g1 = await createUser("g1@test.ru", "x", await code(plain.userId));
    const g2 = await createUser("g2@test.ru", "x", await code(sub.userId));
    assert.ok(g1.ok && g2.ok);
    const pay = async (u: number) => { await db.execute({ sql: "INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at, kind) VALUES (?, ?, 's100', 100, 49000, 'pending', 'mock', 0, 'credits')", args: [`pay-${u}`, u] }); await fulfillPayment(`pay-${u}`); };
    const before = [await getBalance(plain.userId), await getBalance(sub.userId)];
    await pay(g1.userId); await pay(g2.userId);
    const reward = Number((await db.execute("SELECT credits FROM referral_rewards ORDER BY created_at LIMIT 1")).rows[0].credits);
    assert.equal(await getBalance(plain.userId), before[0] + reward);
    assert.equal(await getBalance(sub.userId), before[1] + reward * getPlan("studio")!.perks.referralMultiplier);
  });
});

describe("приветственный бонус и тексты", () => {
  it("по умолчанию три кредита", () => {
    if (process.env.SIGNUP_BONUS_CREDITS === undefined) assert.equal(SIGNUP_BONUS, 3);
  });

  const text = (s: ReturnType<typeof offerSections>) => s.flatMap((x) => [x.title, ...x.body.flat()]).join("\n");

  it("оферта описывает права тарифов, эксклюзив и отчёты из тех же цифр, что в коде", () => {
    const t = text(offerSections());
    for (const p of PLANS) assert.ok(t.includes(`до ${p.perks.exclusiveSlots} эксклюзивов одновременно, ${p.perks.reportsPer30d} отчётов`), p.id);
    assert.ok(t.includes("Эксклюзив. "));
    assert.ok(t.includes("Отчёт для клиента. "));
    assert.ok(t.includes(`${EXCLUSIVE_DAYS} дней`));
  });

  it("политика и согласие упоминают публикацию данных в отчётах", () => {
    assert.ok(text(privacySections()).includes("Публикация данных в отчётах для клиентов"));
    assert.ok(text(consentSections()).includes("отдельной отметкой при создании каждого отчёта"));
  });
});

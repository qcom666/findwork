import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ago, getActivity, getActivitySummary, getUserProfile } from "../src/lib/activity";
import { giftSubscription, listSubscriptions } from "../src/lib/admin";
import { appDb, __resetAppDbForTests } from "../src/lib/db";
import { fmtRub } from "../src/lib/plans";

const T = 1_800_000_000;
const DAY = 86400;

async function user(email: string, o: { created?: number; seen?: number | null } = {}): Promise<number> {
  const r = await (await appDb()).execute({
    sql: "INSERT INTO users(email, pass_hash, balance, created_at, last_seen_at) VALUES (?, 'x', 0, ?, ?)",
    args: [email, o.created ?? T - 10 * DAY, o.seen ?? null],
  });
  return Number(r.lastInsertRowid);
}
const run = async (sql: string, args: (string | number | null)[]) => (await appDb()).execute({ sql, args });

beforeEach(async () => {
  await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-activity-")), "app.db"));
  process.env.ADMIN_EMAILS = "owner@t.ru";
});
afterEach(() => { delete process.env.ADMIN_EMAILS; });

describe("лента активности", () => {
  it("собирает события из разных таблиц, новые сверху, с понятными подписями", async () => {
    const a = await user("a@t.ru", { created: T - 100 });
    await run("INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES ('h', ?, ?, ?)", [a, T + DAY, T - 90]);
    await run("INSERT INTO unlocks(user_id, lead_id, created_at) VALUES (?, 'lead1', ?)", [a, T - 80]);
    await run("INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, -1, 'unlock', 'lead1', ?)", [a, T - 80]);
    await run("INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at, kind, plan_id, months) VALUES ('p1', ?, 'sub', 1500, 249000, 'succeeded', 'yookassa', ?, 'subscription', 'studio', 1)", [a, T - 70]);
    await run("INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, 10, 'admin', 'подарок', ?)", [a, T - 60]);
    await run("INSERT INTO lead_pitches(user_id, lead_id, service, channel, message, source, created_at) VALUES (?, 'lead1', 'site', 'telegram', 'текст', 'claude', ?)", [a, T - 50]);
    await run("INSERT INTO lead_notes(user_id, lead_id, status, note, updated_at) VALUES (?, 'lead1', 'contacted', 'позвонить', ?)", [a, T - 40]);

    const ev = await getActivity();
    assert.deepEqual(ev.map((e) => e.kind), ["crm", "pitch", "credits", "payment", "unlock", "login", "signup"]);
    assert.deepEqual(ev.map((e) => e.text), [
      "статус лида: «Написал», есть заметка",
      "питч для Telegram с ИИ",
      "+10 кр. — начисление от вас (подарок)",
      `оплата прошла: подписку «Студия» на 1 мес., ${fmtRub(2490)}`,
      "открыты контакты",
      "вход на сайт",
      "регистрация",
    ]);
    assert.equal(ev[4].leadId, "lead1");
    assert.equal(ev[3].leadId, null); // у платежа в s3 провайдер, а не заведение
    assert.ok(ev.every((e) => e.user === "a@t.ru" && e.userId === a));
  });

  it("фильтр по виду работает и когда в выборке один вид (имена колонок не теряются)", async () => {
    const a = await user("a@t.ru");
    await run("INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES ('h', ?, ?, ?)", [a, T + DAY, T - 5]);
    const ev = await getActivity({ kinds: ["login"] });
    assert.equal(ev.length, 1);
    assert.deepEqual([ev[0].kind, ev[0].at, ev[0].userId], ["login", T - 5, a]);
  });

  it("аккаунты владельца скрыты, пока их не попросить; по конкретному человеку видно всё", async () => {
    const o = await user("owner@t.ru", { created: T - 20 });
    const a = await user("a@t.ru", { created: T - 10 });
    assert.deepEqual((await getActivity()).map((e) => e.userId), [a]);
    assert.deepEqual((await getActivity({ withOwner: true })).map((e) => e.userId), [a, o]);
    assert.deepEqual((await getActivity({ userId: o })).map((e) => e.userId), [o]);
  });

  it("страницы: before отдаёт события старше, limit ограничивает", async () => {
    const a = await user("a@t.ru", { created: T - 1000 });
    for (let i = 1; i <= 5; i++) await run("INSERT INTO unlocks(user_id, lead_id, created_at) VALUES (?, ?, ?)", [a, `l${i}`, T - i * 10]);
    const first = await getActivity({ limit: 2 });
    assert.deepEqual(first.map((e) => e.at), [T - 10, T - 20]);
    const next = await getActivity({ limit: 2, before: first[1].at });
    assert.deepEqual(next.map((e) => e.at), [T - 30, T - 40]);
  });
});

describe("сводка активности", () => {
  it("считает заходы по времени последнего визита без владельца и находит самых активных", async () => {
    const now = Math.floor(Date.now() / 1000);
    await user("owner@t.ru", { seen: now - 10 });
    const a = await user("a@t.ru", { seen: now - 60 });
    const b = await user("b@t.ru", { seen: now - 3 * 3600 });
    await user("c@t.ru", { seen: now - 10 * DAY });
    await user("d@t.ru");
    for (const l of ["x", "y"]) await run("INSERT INTO unlocks(user_id, lead_id, created_at) VALUES (?, ?, ?)", [b, l, now - 100]);
    await run("INSERT INTO unlocks(user_id, lead_id, created_at) VALUES (?, 'z', ?)", [a, now - 100]);
    await run("INSERT INTO unlocks(user_id, lead_id, created_at) VALUES (?, 'old', ?)", [a, now - 20 * DAY]);

    const s = await getActivitySummary(now);
    assert.deepEqual([s.online, s.day, s.week, s.month], [1, 2, 2, 3]);
    assert.deepEqual(s.top.map((x) => [x.userId, x.events]), [[b, 2], [a, 1]]);
    assert.equal(s.trackedSince, now - 10 * DAY);
  });
});

describe("карточка пользователя", () => {
  it("собирает счётчики, деньги только боевые, подписку", async () => {
    const a = await user("a@t.ru", { seen: T - 5 });
    await run("INSERT INTO unlocks(user_id, lead_id, created_at) VALUES (?, 'l1', 0), (?, 'l2', 0)", [a, a]);
    await run("INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at) VALUES ('p1', ?, 's', 20, 49000, 'succeeded', 'yookassa', 0), ('p2', ?, 's', 20, 49000, 'succeeded', 'mock', 0)", [a, a]);
    await user("r@t.ru"); await run("UPDATE users SET referred_by = ? WHERE email = 'r@t.ru'", [a]);
    await giftSubscription("a@t.ru", "freelance", 2);

    const p = (await getUserProfile(a))!;
    assert.deepEqual([p.unlocks, p.paidRub, p.referrals, p.lastSeenAt, p.isAdmin], [2, 490, 1, T - 5, false]);
    assert.deepEqual(p.subscriptions.map((s) => [s.title, s.months]), [["Фриланс", 2]]);
    assert.equal(await getUserProfile(999), null);
  });
});

describe("список подписок", () => {
  it("показывает действующие и ждущие, отмечает подаренные", async () => {
    const a = await user("a@t.ru");
    await run("INSERT INTO subscriptions(user_id, payment_id, plan_id, months, credits_per_month, starts_at, ends_at, granted, created_at) VALUES (?, 'pay', 'studio', 1, 1500, 0, 9999999999, 1, 0), (?, 'old', 'studio', 1, 1500, 0, 100, 1, 0)", [a, a]);
    await giftSubscription("a@t.ru", "agency", 1);
    const list = await listSubscriptions();
    // подарок встал в очередь за оплаченной, поэтому кончится позже; закончившаяся не показывается
    assert.deepEqual(list.map((s) => [s.title, s.gift]), [["Студия", false], ["Агентство", true]]);
  });
});

describe("относительное время", () => {
  it("минуты, часы, вчера, дата", () => {
    assert.equal(ago(T - 30, T), "только что");
    assert.equal(ago(T - 12 * 60, T), "12 мин назад");
    assert.equal(ago(T - 3 * 3600, T), "3 ч назад");
    assert.match(ago(T - 30 * 3600, T), /^вчера в \d\d:\d\d$/);
    assert.doesNotMatch(ago(T - 5 * DAY, T), /назад|вчера/);
  });
});

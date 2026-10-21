import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { createClient } from "@libsql/client";

const dir = mkdtempSync(path.join(tmpdir(), "fw-search-"));
process.env.LEADS_DB_URL = "file:" + path.join(dir, "leads.db");

import { countByStatus, getCrm, listUnlockedIdsByStatus, saveCrm } from "../src/lib/crm";
import { unlockLead } from "../src/lib/credits";
import { __resetAppDbForTests } from "../src/lib/db";
import { clearCache } from "../src/lib/cache";
import { getMetrics, isAdminEmail } from "../src/lib/metrics";
import { getLead, parseParams, searchLeads, toQuery } from "../src/lib/search";

const COLS = "id,name,niche,category,city,address,lat,lon,phone,phones,email,website,site_kind,socials,has_phone,has_email,has_social,is_chain,confidence,sources,score,services,name_norm";
type Row = Record<string, string | number | null>;
const base: Row = {
  category: null, address: null, lat: 55, lon: 49, phone: "+78435550001", phones: '["+78435550001"]', email: "a@b.ru", website: null,
  site_kind: "none", socials: "[]", has_phone: 1, has_email: 1, has_social: 0, is_chain: 0, confidence: 0.9, sources: "overture:meta",
  score: 70, services: "site,seo", name_norm: "",
};
const rows: Row[] = [
  { ...base, id: "a", name: "Стоматология Улыбка", niche: "medical", city: "Казань", score: 85, services: "site,booking,seo" },
  { ...base, id: "b", name: "Кофейня Зерно", niche: "food", city: "Казань", score: 60, services: "site,qr_menu,smm", has_social: 1, socials: '["https://vk.com/zerno"]', site_kind: "social" },
  { ...base, id: "c", name: "Автомойка Блеск", niche: "auto", city: "Москва", score: 45, services: "booking,seo", phone: null, phones: "[]", has_phone: 0 },
  { ...base, id: "d", name: "Пятёрочка", niche: "shops", city: "Казань", score: 20, services: "seo", is_chain: 1 },
  { ...base, id: "e", name: "Барбершоп Борода", niche: "beauty", city: "Казань", score: 75, services: "site,booking", site_kind: "builder", website: "https://borodabarber.tilda.ws" },
  { ...base, id: "f", name: "Юрист Иванов", niche: "legal", city: "Санкт-Петербург", score: 90, services: "site,seo", site_kind: "real", website: "https://ivanov-law.ru" },
];

let appDir: string;

before(async () => {
  const db = createClient({ url: process.env.LEADS_DB_URL! });
  await db.batch(
    [
      `CREATE TABLE places (${COLS.split(",").map((c) => c).join(",")})`,
      `CREATE TABLE niches (id TEXT PRIMARY KEY, label TEXT, n INTEGER, n_need INTEGER)`,
      `CREATE TABLE cities (name TEXT PRIMARY KEY, n INTEGER, n_need INTEGER)`,
      `CREATE VIRTUAL TABLE places_fts USING fts5(name, content='places', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`,
    ],
    "write",
  );
  for (const r of rows) {
    await db.execute({ sql: `INSERT INTO places (${COLS}) VALUES (${COLS.split(",").map(() => "?").join(",")})`, args: COLS.split(",").map((c) => r[c] ?? null) });
  }
  await db.execute("INSERT INTO places_fts(rowid, name) SELECT rowid, name FROM places");
  // справочники так же, как их считает ingest/build_db.py
  await db.execute("INSERT INTO niches SELECT niche, niche, count(*), count(*) FILTER (WHERE site_kind <> 'real' AND is_chain = 0) FROM places GROUP BY niche");
  await db.execute("INSERT INTO cities SELECT city, count(*), count(*) FILTER (WHERE site_kind <> 'real' AND is_chain = 0) FROM places GROUP BY city");
  appDir = mkdtempSync(path.join(tmpdir(), "fw-crm-"));
  await __resetAppDbForTests("file:" + path.join(appDir, "app.db"));
});

const ids = async (sp: Record<string, string>, user?: number) => (await searchLeads(parseParams(sp), user)).leads.map((l) => l.id);

describe("параметры поиска", () => {
  it("неизвестные значения заменяются безопасными, а в адрес не попадают значения по умолчанию", () => {
    const p = parseParams({ service: "drop table", min: "55", sort: "evil", site: "wat", page: "-4" });
    assert.equal(p.service, "");
    assert.equal(p.minScore, 0);
    assert.equal(p.sort, "score");
    assert.equal(p.site, "need");
    assert.equal(p.page, 1);
    assert.equal(toQuery(p), "");
    assert.equal(toQuery(parseParams({ service: "booking", min: "60", sort: "name", city: "Казань" })), "city=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C&service=booking&min=60&sort=name");
  });
});

describe("фильтры каталога", () => {
  it("по умолчанию: нужен сайт, сети скрыты, сначала горячие", async () => {
    assert.deepEqual(await ids({}), ["a", "e", "b", "c"]);
  });
  it("по услуге (специализации)", async () => {
    assert.deepEqual(await ids({ service: "booking" }), ["a", "e", "c"]);
    assert.deepEqual(await ids({ service: "qr_menu" }), ["b"]);
    assert.deepEqual(await ids({ service: "se" }), await ids({}), "неизвестная услуга игнорируется, а не ищется по подстроке");
  });
  it("по нише, городу, оценке и наличию контактов", async () => {
    assert.deepEqual(await ids({ niche: "medical" }), ["a"]);
    assert.deepEqual(await ids({ city: "Москва" }), ["c"]);
    assert.deepEqual(await ids({ min: "70" }), ["a", "e"]);
    assert.deepEqual(await ids({ phone: "1" }), ["a", "e", "b"]);
    assert.deepEqual(await ids({ social: "1" }), ["b"]);
  });
  it("статус сайта и сети", async () => {
    assert.deepEqual(await ids({ site: "builder" }), ["e"]);
    assert.deepEqual(await ids({ site: "real" }), ["f"]);
    assert.deepEqual(await ids({ site: "any", chains: "1" }), ["f", "a", "e", "b", "c", "d"]);
  });
  it("сортировка по названию и поиск по началу слова", async () => {
    assert.deepEqual(await ids({ sort: "name" }), ["c", "e", "b", "a"]);
    assert.deepEqual(await ids({ q: "стом" }), ["a"]);
    assert.deepEqual(await ids({ q: "кофе" }), ["b"]);
  });
  it("слово из своей ниши находит и заведения без него в названии", async () => {
    assert.deepEqual(await ids({ q: "кафе" }), ["b"], "Кофейня Зерно из ниши food, хотя слова «кафе» в названии нет");
    assert.deepEqual(await ids({ q: "автомойка" }), ["c"]);
    const r = await searchLeads(parseParams({ q: "стоматология" }));
    assert.deepEqual(r.matchedNiches, ["medical"]);
  });
  it("услуга «Вывеска» допустима как фильтр", async () => {
    assert.equal(parseParams({ service: "signage" }).service, "signage");
    assert.deepEqual(await ids({ service: "signage" }), []);
  });
  it("кавычки и спецсимволы в запросе не ломают поиск", async () => {
    assert.deepEqual(await ids({ q: '"; DROP TABLE places; --' }), []);
    assert.equal((await ids({})).length, 4);
  });
});

describe("подсчёт найденных", () => {
  it("быстрый подсчёт по справочникам совпадает с честным count(*)", async () => {
    const real = createClient({ url: process.env.LEADS_DB_URL! });
    const count = async (where: string) => Number((await real.execute(`SELECT count(*) AS n FROM places WHERE site_kind IN ('none','social','builder') AND is_chain = 0 ${where}`)).rows[0].n);
    assert.equal((await searchLeads(parseParams({}))).total, await count(""));
    assert.equal((await searchLeads(parseParams({ city: "Казань" }))).total, await count("AND city = 'Казань'"));
    assert.equal((await searchLeads(parseParams({ niche: "medical" }))).total, await count("AND niche = 'medical'"));
    assert.equal((await searchLeads(parseParams({ city: "Казань", niche: "food" }))).total, await count("AND city = 'Казань' AND niche = 'food'"));
    assert.equal((await searchLeads(parseParams({ city: "Нет такого" }))).total, 0, "город вне справочника считается честно");
  });
});

describe("предел подсчёта", () => {
  it("если найденных больше предела, число обрезается и помечается как приблизительное", async () => {
    clearCache(); // подсчёты кэшируются, а предел в этом тесте меняется
    process.env.COUNT_CAP = "2";
    try {
      const r = await searchLeads(parseParams({ phone: "1", q: "" }));
      assert.deepEqual([r.total, r.capped], [2, true]);
      process.env.COUNT_CAP = "3";
      const exact = await searchLeads(parseParams({ phone: "1", min: "40" }));
      assert.deepEqual([exact.total, exact.capped], [3, false], "ровно по пределу: число точное");
    } finally {
      delete process.env.COUNT_CAP;
      clearCache();
    }
  });
});

describe("скрытие контактов", () => {
  it("пока лид не открыт, телефон и почта не выходят из слоя поиска", async () => {
    const l = (await getLead("a", 1))!;
    assert.equal(l.unlocked, false);
    assert.equal(l.phone, null);
    assert.equal(l.email, null);
    assert.deepEqual(l.phones, []);
    assert.equal(l.has.phone, true);
    assert.equal(l.preview.phone, "+7 (843) •••-••-••");
    assert.ok(!JSON.stringify(l).includes("5550001"));
  });
  it("после открытия контакты видны, у другого пользователя всё ещё скрыты", async () => {
    const app = await (await import("../src/lib/db")).appDb();
    for (const email of ["u1@t.ru", "u2@t.ru"]) await app.execute({ sql: "INSERT INTO users(email, pass_hash, balance, created_at) VALUES (?, 'x', 3, 0)", args: [email] });
    assert.equal((await unlockLead(1, "a")).ok, true);
    assert.equal((await getLead("a", 1))!.phone, "+78435550001");
    assert.equal((await getLead("a", 2))!.phone, null);
    const list = (await searchLeads(parseParams({}), 1)).leads;
    assert.equal(list.find((x) => x.id === "a")!.unlocked, true);
    assert.equal(list.find((x) => x.id === "b")!.phone, null);
  });
});

describe("статусы и заметки", () => {
  it("статус и заметка обновляются независимо друг от друга", async () => {
    await saveCrm(1, "a", { status: "contacted" });
    assert.deepEqual((await getCrm(1, ["a"])).get("a"), { status: "contacted", note: "" });
    await saveCrm(1, "a", { note: "Перезвонить в пятницу" });
    assert.deepEqual((await getCrm(1, ["a"])).get("a"), { status: "contacted", note: "Перезвонить в пятницу" });
    await saveCrm(1, "a", { status: "replied" });
    assert.deepEqual((await getCrm(1, ["a"])).get("a"), { status: "replied", note: "Перезвонить в пятницу" });
  });
  it("заметки разных пользователей не пересекаются", async () => {
    assert.equal((await getCrm(2, ["a"])).size, 0);
  });
  it("счётчики и список по этапам, лид без записи считается новым", async () => {
    await unlockLead(1, "b");
    assert.deepEqual(await countByStatus(1), { replied: 1, new: 1 });
    assert.deepEqual(await listUnlockedIdsByStatus(1, "new", 10), ["b"]);
    assert.deepEqual(await listUnlockedIdsByStatus(1, "replied", 10), ["a"]);
    assert.deepEqual((await listUnlockedIdsByStatus(1, "", 10)).sort(), ["a", "b"]);
  });
});

describe("метрики владельца", () => {
  it("считает людей, выручку и открытия, тестовые платежи не входят в выручку", async () => {
    const app = await (await import("../src/lib/db")).appDb();
    const t = Math.floor(Date.now() / 1000);
    const pay = (id: string, user: number, status: string, provider: string) =>
      app.execute({
        sql: "INSERT INTO payments(id, user_id, package_id, credits, amount_kop, status, provider, created_at, paid_at) VALUES (?, ?, 's20', 20, 49000, ?, ?, ?, ?)",
        args: [id, user, status, provider, t, status === "succeeded" ? t : null],
      });
    await pay("m1", 1, "succeeded", "yookassa");
    await pay("m2", 2, "pending", "yookassa");
    await pay("m3", 2, "succeeded", "mock");

    const m = await getMetrics();
    assert.equal(m.users.total, 2);
    assert.equal(m.money.revenueRub, 490);
    assert.equal(m.money.payments, 1);
    assert.equal(m.money.pending, 1);
    assert.equal(m.users.payers, 2, "платящими считаются и тестовые, но деньги только боевые");
    assert.ok(m.usage.unlocks >= 2);
    assert.ok(m.topNiches.some((n) => n.niche === "medical"));
    assert.match(m.recentPayments[0].email, /^u1•••@t\.ru$|^u2•••@t\.ru$/);
  });

  it("админом считается только тот, кто указан в ADMIN_EMAILS", () => {
    delete process.env.ADMIN_EMAILS;
    assert.equal(isAdminEmail("boss@x.ru"), false);
    process.env.ADMIN_EMAILS = " Boss@X.ru , other@x.ru";
    assert.equal(isAdminEmail("boss@x.ru"), true);
    assert.equal(isAdminEmail("someone@x.ru"), false);
    assert.equal(isAdminEmail(null), false);
    delete process.env.ADMIN_EMAILS;
  });
});

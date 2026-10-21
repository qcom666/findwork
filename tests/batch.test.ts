import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { createClient } from "@libsql/client";

const dir = mkdtempSync(path.join(tmpdir(), "fw-batch-"));
process.env.LEADS_DB_URL = "file:" + path.join(dir, "leads.db");
delete process.env.ANTHROPIC_API_KEY; // тест на шаблонах: без обращения к модели

import { generateBatch } from "../src/lib/batch";
import { unlockLead } from "../src/lib/credits";
import { __resetAppDbForTests, appDb } from "../src/lib/db";
import { getPitches, savePitch } from "../src/lib/pitch-store";
import { allow } from "../src/lib/ratelimit";

const COLS = "id,name,niche,category,city,address,lat,lon,phone,phones,email,website,site_kind,socials,has_phone,has_email,has_social,is_chain,confidence,sources,score,services,name_norm";
const base: Record<string, string | number | null> = {
  category: null, address: null, lat: 55, lon: 49, phone: "+79046660653", phones: '["+79046660653"]', email: "a@b.ru", website: null,
  site_kind: "none", socials: "[]", has_phone: 1, has_email: 1, has_social: 0, is_chain: 0, confidence: 0.9, sources: "overture:meta", score: 70, name_norm: "",
};
const rows = [
  { ...base, id: "a", name: "Салон Лотос", niche: "beauty", city: "Казань", services: "booking,site,seo" },
  { ...base, id: "b", name: "Кофейня Зерно", niche: "food", city: "Казань", services: "qr_menu,site" },
  { ...base, id: "c", name: "Автомойка Блеск", niche: "auto", city: "Москва", services: "site" },
];
const profile = { name: "Алексей", skills: "Сайты", portfolio: "", priceFrom: "" };

before(async () => {
  const db = createClient({ url: process.env.LEADS_DB_URL! });
  await db.batch([
    `CREATE TABLE places (${COLS})`,
    `CREATE TABLE niches (id TEXT PRIMARY KEY, label TEXT, n INTEGER, n_need INTEGER)`,
    `CREATE TABLE services (id TEXT PRIMARY KEY, label TEXT)`,
    `INSERT INTO niches VALUES ('beauty','Салоны красоты',1,1),('food','Кафе и рестораны',1,1),('auto','Автосервис',1,1)`,
    `INSERT INTO services VALUES ('site','Сайт-визитка или лендинг'),('booking','Онлайн-запись'),('qr_menu','QR-меню и онлайн-заказ'),('seo','SEO и карточки на картах')`,
  ], "write");
  for (const r of rows) await db.execute({ sql: `INSERT INTO places (${COLS}) VALUES (${COLS.split(",").map(() => "?").join(",")})`, args: COLS.split(",").map((c) => (r as Record<string, string | number | null>)[c] ?? null) });
  await __resetAppDbForTests("file:" + path.join(mkdtempSync(path.join(tmpdir(), "fw-batch-app-")), "app.db"));
  const app = await appDb();
  for (const e of ["u1@t.ru", "u2@t.ru"]) await app.execute({ sql: "INSERT INTO users(email, pass_hash, balance, created_at) VALUES (?, 'x', 10, 0)", args: [e] });
  await unlockLead(1, "a");
  await unlockLead(1, "b");
});

describe("пакетные питчи", () => {
  it("пишет и сохраняет питчи только для открытых лидов, остальные отклоняет", async () => {
    const r = await generateBatch({ userId: 1, ids: ["a", "b", "c", "нет-такого"], service: "auto", channel: "whatsapp", profile });
    assert.deepEqual(r.map((x) => [x.id, x.ok]), [["a", true], ["b", true], ["c", false], ["нет-такого", false]]);
    const saved = await getPitches(1, ["a", "b", "c"]);
    assert.equal(saved.size, 2);
    assert.equal(saved.get("a")!.channel, "whatsapp");
    assert.equal(saved.get("a")!.source, "template");
    assert.match(saved.get("a")!.message, /Алексей/);
    assert.match(saved.get("a")!.message, /Салон Лотос/);
  });

  it("«Подбирать под каждого» берёт первую услугу из списка заведения", async () => {
    const saved = await getPitches(1, ["a", "b"]);
    assert.equal(saved.get("a")!.service, "booking");
    assert.equal(saved.get("b")!.service, "qr_menu");
  });

  it("выбранная услуга применяется ко всем, неизвестная заменяется подсказкой заведения", async () => {
    await generateBatch({ userId: 1, ids: ["a", "b"], service: "seo", channel: "email", profile });
    let s = await getPitches(1, ["a", "b"]);
    assert.equal(s.get("a")!.service, "seo");
    assert.equal(s.get("b")!.service, "seo");
    await generateBatch({ userId: 1, ids: ["a", "b"], service: "drop table", channel: "email", profile });
    s = await getPitches(1, ["a", "b"]);
    assert.equal(s.get("a")!.service, "booking");
  });

  it("новый питч заменяет прежний, а не копится", async () => {
    await generateBatch({ userId: 1, ids: ["a"], service: "site", channel: "telegram", profile: { ...profile, name: "Мария" } });
    const s = (await getPitches(1, ["a"])).get("a")!;
    assert.match(s.message, /Мария/);
    assert.equal(s.channel, "telegram");
    const app = await appDb();
    assert.equal(Number((await app.execute("SELECT count(*) AS n FROM lead_pitches WHERE user_id = 1 AND lead_id = 'a'")).rows[0].n), 1);
  });

  it("другой пользователь не может писать питчи по чужим открытым лидам и не видит чужие тексты", async () => {
    const r = await generateBatch({ userId: 2, ids: ["a", "b"], service: "auto", channel: "email", profile });
    assert.ok(r.every((x) => !x.ok));
    assert.equal((await getPitches(2, ["a", "b"])).size, 0);
  });

  it("за один запрос не больше положенного числа, дубли схлопываются", async () => {
    const r = await generateBatch({ userId: 1, ids: ["a", "a", "a"], service: "auto", channel: "call", profile });
    assert.equal(r.length, 1);
  });

  it("длинный текст при сохранении обрезается", async () => {
    await savePitch(1, "a", { service: "site", channel: "email", subject: "т".repeat(900), message: "м".repeat(9000), followup: "", angle: "", source: "template" });
    const s = (await getPitches(1, ["a"])).get("a")!;
    assert.equal(s.subject.length, 300);
    assert.equal(s.message.length, 4000);
  });
});

describe("лимит с ценой запроса", () => {
  it("пакет тратит столько единиц лимита, сколько в нём питчей", async () => {
    assert.equal(await allow("t:limit", 10, 3600, 6), true);
    assert.equal(await allow("t:limit", 10, 3600, 4), true);
    assert.equal(await allow("t:limit", 10, 3600, 1), false);
    assert.equal(await allow("t:other", 10, 3600, 11), false);
  });
});

#!/usr/bin/env node
/**
 * Копирует каталог заведений из локального SQLite-файла в удалённую базу libSQL (Turso).
 * Нужен потому, что `turso db create --from-file` не принимает наш файл с полнотекстовым индексом.
 *
 *   SRC=data/leads.db DEST_URL=libsql://... DEST_TOKEN=... node scripts/push-leads.mjs
 *
 * Порядок: таблицы без индексов -> данные пачками -> индексы -> полнотекстовый индекс (строится на стороне базы).
 */
import { createClient } from "@libsql/client";

const SRC = process.env.SRC ?? "data/leads.db";
const DEST_URL = process.env.DEST_URL;
const DEST_TOKEN = process.env.DEST_TOKEN || undefined;
const BATCH = 400;

if (!DEST_URL) {
  console.error("Нужна переменная DEST_URL");
  process.exit(1);
}

const src = createClient({ url: SRC.includes(":") ? SRC : `file:${SRC}` });
const dest = createClient({ url: DEST_URL, authToken: DEST_TOKEN });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(label, fn, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw new Error(`${label}: ${e.message}`);
      await sleep(500 * i * i);
    }
  }
}

// Схема. Служебные таблицы SQLite и таблицы полнотекстового индекса пересоздаём отдельно.
const master = (await src.execute("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL")).rows;
const skip = (r) => r.name.startsWith("sqlite_") || r.name.startsWith("places_fts");
const tables = master.filter((r) => r.type === "table" && !skip(r));
const indexes = master.filter((r) => r.type === "index" && !skip(r) && !r.name.startsWith("sqlite_autoindex"));

for (const t of tables) await retry(`create ${t.name}`, () => dest.execute(String(t.sql)));
console.log(`Таблиц создано: ${tables.length}`);

for (const t of tables) {
  const name = String(t.name);
  const total = Number((await src.execute(`SELECT count(*) AS n FROM "${name}"`)).rows[0].n);
  const cols = (await src.execute(`PRAGMA table_info("${name}")`)).rows.map((c) => String(c.name));
  const colList = cols.map((c) => `"${c}"`).join(",");
  const row = `(${cols.map(() => "?").join(",")})`;
  let done = 0;
  const started = Date.now();

  // Идём по rowid, чтобы порядок строк и rowid в удалённой базе совпали с локальными (на них опирается FTS).
  for (let lastRowid = 0; ; ) {
    const rs = await src.execute({
      sql: `SELECT rowid AS __rowid, ${colList} FROM "${name}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      args: [lastRowid, BATCH],
    });
    if (!rs.rows.length) break;
    const args = [];
    for (const r of rs.rows) for (const c of cols) args.push(r[c] ?? null);
    lastRowid = Number(rs.rows[rs.rows.length - 1].__rowid);
    await retry(`insert ${name}`, () =>
      dest.execute({ sql: `INSERT INTO "${name}" (${colList}) VALUES ${rs.rows.map(() => row).join(",")}`, args }),
    );
    done += rs.rows.length;
    if (done % (BATCH * 25) < BATCH || done === total) {
      const sec = Math.round((Date.now() - started) / 1000);
      console.log(`  ${name}: ${done}/${total} (${sec} с)`);
    }
  }
  const remote = Number((await dest.execute(`SELECT count(*) AS n FROM "${name}"`)).rows[0].n);
  if (remote !== total) throw new Error(`${name}: в источнике ${total}, в базе ${remote}`);
}

for (const i of indexes) await retry(`index ${i.name}`, () => dest.execute(String(i.sql)));
console.log(`Индексов создано: ${indexes.length}`);

// Полнотекстовый индекс по названиям: тот же, что собирает ingest/build_db.py.
await retry("fts create", () =>
  dest.execute(
    "CREATE VIRTUAL TABLE places_fts USING fts5(name, content='places', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')",
  ),
);
await retry("fts fill", () => dest.execute("INSERT INTO places_fts(rowid, name) SELECT rowid, name FROM places"));
const hit = await dest.execute({
  sql: "SELECT count(*) AS n FROM places WHERE rowid IN (SELECT rowid FROM places_fts WHERE places_fts MATCH ?)",
  args: ['"стом"*'],
});
console.log(`Поиск по названию работает: «стом*» находит ${hit.rows[0].n}`);
console.log("Каталог загружен.");

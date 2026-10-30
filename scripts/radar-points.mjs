#!/usr/bin/env node
/**
 * Точки для фона «Радар» на главной: настоящие заведения Москвы из каталога, чтобы на фоне проступал город, а не случайный шум.
 * Берёт случайную выборку в радиусе от Кремля и пишет смещения в десятках метров (целые числа) в src/components/radar-points.ts.
 * Перезапускать не обязательно: фону хватает и старого каталога.
 *
 *   node scripts/radar-points.mjs [путь к leads.db]
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const DB = process.argv[2] || "data/leads.db";
const [LAT0, LON0] = [55.7539, 37.6208]; // Кремль
const RADIUS_KM = 15;
const LIMIT = 1400;
const NEED = "site_kind IN ('none','social','builder') AND is_chain = 0"; // как фильтр «нужен сайт» в src/lib/search.ts

const kx = 111.32 * Math.cos((LAT0 * Math.PI) / 180);
const ky = 110.57;
const dLat = RADIUS_KM / ky;
const dLon = RADIUS_KM / kx;

const db = createClient({ url: `file:${DB}` });
const { rows } = await db.execute({
  sql: `SELECT lat, lon, ${NEED} AS hot FROM places
        WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY random() LIMIT ?`,
  args: [LAT0 - dLat, LAT0 + dLat, LON0 - dLon, LON0 + dLon, LIMIT * 2],
});

const hot = [];
const rest = [];
let n = 0;
for (const r of rows) {
  const x = (Number(r.lon) - LON0) * kx;
  const y = (LAT0 - Number(r.lat)) * ky; // ось y вниз, как на экране
  if (Math.hypot(x, y) > RADIUS_KM || n >= LIMIT) continue;
  (r.hot ? hot : rest).push(Math.round(x * 100), Math.round(y * 100));
  n++;
}

const out = `// Сгенерировано scripts/radar-points.mjs: заведения Москвы в радиусе ${RADIUS_KM} км от Кремля, смещения в десятках метров (x вправо, y вниз).
// HOT: заведения без своего сайта (кандидаты), REST: остальные. Пары x, y подряд.
export const RADAR_RADIUS = ${RADIUS_KM * 100};
export const RADAR_HOT = [${hot.join(",")}];
export const RADAR_REST = [${rest.join(",")}];
`;
writeFileSync(new URL("../src/components/radar-points.ts", import.meta.url), out);
console.log(`Готово: ${hot.length / 2} без сайта, ${rest.length / 2} остальных`);

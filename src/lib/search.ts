import { unlockedAmong } from "./credits";
import { leadsDb } from "./db";
import { maskEmail, maskPhone, socialNames } from "./mask";

export type SiteKind = "none" | "social" | "builder" | "real";

export type Lead = {
  id: string;
  name: string;
  niche: string;
  category: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  siteKind: SiteKind;
  isChain: boolean;
  confidence: number | null;
  sources: string[];
  score: number;
  services: string[];
  /** Контакты открыты для текущего пользователя. Пока нет, поля ниже пустые, а наружу идут только превью. */
  unlocked: boolean;
  has: { phone: boolean; email: boolean; social: boolean; website: boolean };
  preview: { phone: string | null; email: string | null; socials: string[] };
  phone: string | null;
  phones: string[];
  email: string | null;
  website: string | null;
  socials: string[];
};

type Row = {
  id: string; name: string; niche: string; category: string | null; city: string | null; address: string | null;
  lat: number | null; lon: number | null; phone: string | null; phones: string | null; email: string | null;
  website: string | null; site_kind: SiteKind; socials: string | null; is_chain: number; confidence: number | null;
  sources: string | null; score: number; services: string | null;
};

function parseList(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Единственное место, где контакты выпускаются наружу: без unlocked=true они вырезаются здесь. */
function toLead(r: Row, unlocked: boolean): Lead {
  const phones = parseList(r.phones);
  const socials = parseList(r.socials);
  return {
    id: r.id, name: r.name, niche: r.niche, category: r.category, city: r.city, address: r.address,
    lat: r.lat, lon: r.lon, siteKind: r.site_kind, isChain: r.is_chain === 1, confidence: r.confidence,
    sources: r.sources ? r.sources.split(",") : [], score: r.score, services: r.services ? r.services.split(",") : [],
    unlocked,
    has: { phone: !!r.phone, email: !!r.email, social: socials.length > 0, website: !!r.website },
    preview: { phone: maskPhone(r.phone), email: maskEmail(r.email), socials: socialNames(socials) },
    phone: unlocked ? r.phone : null,
    phones: unlocked ? phones : [],
    email: unlocked ? r.email : null,
    website: unlocked ? r.website : null,
    socials: unlocked ? socials : [],
  };
}

export type SiteFilter = "need" | "none" | "social" | "builder" | "real" | "any";

export type Params = {
  city: string;
  niche: string;
  site: SiteFilter;
  phone: boolean;
  email: boolean;
  chains: boolean;
  q: string;
  page: number;
};

export const PAGE_SIZE = 30;

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseParams(sp: RawParams): Params {
  const site = one(sp.site) as SiteFilter;
  const page = Math.max(1, Math.min(5000, parseInt(one(sp.page), 10) || 1));
  return {
    city: one(sp.city).slice(0, 80),
    niche: one(sp.niche).slice(0, 40),
    site: ["need", "none", "social", "builder", "real", "any"].includes(site) ? site : "need",
    phone: one(sp.phone) === "1",
    email: one(sp.email) === "1",
    chains: one(sp.chains) === "1",
    q: one(sp.q).slice(0, 80),
    page,
  };
}

export function toQuery(p: Partial<Params>): string {
  const u = new URLSearchParams();
  if (p.city) u.set("city", p.city);
  if (p.niche) u.set("niche", p.niche);
  if (p.site && p.site !== "need") u.set("site", p.site);
  if (p.phone) u.set("phone", "1");
  if (p.email) u.set("email", "1");
  if (p.chains) u.set("chains", "1");
  if (p.q) u.set("q", p.q);
  if (p.page && p.page > 1) u.set("page", String(p.page));
  return u.toString();
}

function ftsQuery(q: string): string | null {
  const tokens = q.match(/[\p{L}\p{N}]+/gu);
  if (!tokens) return null;
  return tokens.slice(0, 6).map((t) => `"${t}"*`).join(" ");
}

function where(p: Params): { sql: string; args: (string | number)[] } {
  const w: string[] = [];
  const a: (string | number)[] = [];
  if (p.city) { w.push("p.city = ?"); a.push(p.city); }
  if (p.niche) { w.push("p.niche = ?"); a.push(p.niche); }
  switch (p.site) {
    case "need": w.push("p.site_kind IN ('none','social','builder')"); break;
    case "any": break;
    default: w.push("p.site_kind = ?"); a.push(p.site);
  }
  if (p.phone) w.push("p.has_phone = 1");
  if (p.email) w.push("p.has_email = 1");
  if (!p.chains) w.push("p.is_chain = 0");
  const fts = p.q ? ftsQuery(p.q) : null;
  if (fts) { w.push("p.rowid IN (SELECT rowid FROM places_fts WHERE places_fts MATCH ?)"); a.push(fts); }
  return { sql: w.length ? "WHERE " + w.join(" AND ") : "", args: a };
}

const rows = (rs: { rows: unknown[] }) => rs.rows as unknown as Row[];

export async function searchLeads(p: Params, userId?: number | null): Promise<{ leads: Lead[]; total: number }> {
  const db = leadsDb();
  const { sql, args } = where(p);
  const [count, page] = await Promise.all([
    db.execute({ sql: `SELECT count(*) AS n FROM places p ${sql}`, args }),
    db.execute({
      sql: `SELECT p.* FROM places p ${sql} ORDER BY p.score DESC, p.rowid LIMIT ? OFFSET ?`,
      args: [...args, PAGE_SIZE, (p.page - 1) * PAGE_SIZE],
    }),
  ]);
  const list = rows(page);
  const open = await unlockedAmong(userId, list.map((r) => r.id));
  return { leads: list.map((r) => toLead(r, open.has(r.id))), total: Number(count.rows[0].n) };
}

/** Заведение для показа пользователю: контакты только если он их открыл. */
export async function getLead(id: string, userId?: number | null): Promise<Lead | null> {
  const rs = await leadsDb().execute({ sql: "SELECT * FROM places WHERE id = ?", args: [id] });
  const r = rows(rs)[0];
  if (!r) return null;
  const open = await unlockedAmong(userId, [id]);
  return toLead(r, open.has(id));
}

/** Заведение с контактами. Вызывать только после проверки, что пользователь его открыл. */
export async function getLeadsUnlocked(ids: string[]): Promise<Lead[]> {
  if (!ids.length) return [];
  const rs = await leadsDb().execute({
    sql: `SELECT * FROM places WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  const byId = new Map(rows(rs).map((r) => [r.id, toLead(r, true)]));
  return ids.map((id) => byId.get(id)).filter((l): l is Lead => !!l);
}

export async function leadExists(id: string): Promise<boolean> {
  const rs = await leadsDb().execute({ sql: "SELECT 1 FROM places WHERE id = ?", args: [id] });
  return rs.rows.length > 0;
}

export type Option = { id: string; label: string; n: number; nNeed: number };

export async function getNiches(): Promise<Option[]> {
  const rs = await leadsDb().execute("SELECT id, label, n, n_need FROM niches WHERE n > 0 ORDER BY n_need DESC");
  return rs.rows.map((r) => ({ id: String(r.id), label: String(r.label), n: Number(r.n), nNeed: Number(r.n_need) }));
}

export async function getCities(limit = 200): Promise<Option[]> {
  const rs = await leadsDb().execute({ sql: "SELECT name, n, n_need FROM cities ORDER BY n DESC LIMIT ?", args: [limit] });
  return rs.rows.map((r) => ({ id: String(r.name), label: String(r.name), n: Number(r.n), nNeed: Number(r.n_need) }));
}

export async function getLabels(): Promise<{ niches: Record<string, string>; services: Record<string, string> }> {
  const db = leadsDb();
  const [n, s] = await Promise.all([db.execute("SELECT id, label FROM niches"), db.execute("SELECT id, label FROM services")]);
  const niches: Record<string, string> = {};
  const services: Record<string, string> = {};
  for (const r of n.rows) niches[String(r.id)] = String(r.label);
  for (const r of s.rows) services[String(r.id)] = String(r.label);
  return { niches, services };
}

export async function getMeta(): Promise<Record<string, string>> {
  const rs = await leadsDb().execute("SELECT key, value FROM meta");
  const out: Record<string, string> = {};
  for (const r of rs.rows) out[String(r.key)] = String(r.value);
  return out;
}

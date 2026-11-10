import { appDb, leadsDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [catalog] = await Promise.all([
      leadsDb().execute("SELECT key, value FROM meta WHERE key IN ('built_at', 'total')"),
      appDb().then((db) => db.execute("SELECT 1")),
    ]);
    const meta = Object.fromEntries(catalog.rows.map((row) => [String(row.key), String(row.value)]));

    return Response.json(
      { status: "ok", catalog: { builtAt: meta.built_at ?? null, total: Number(meta.total) || null } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "error" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

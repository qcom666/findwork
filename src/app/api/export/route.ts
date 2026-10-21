import { getCurrentUser } from "@/lib/auth";
import { listUnlockedIds } from "@/lib/credits";
import { getCrm, STATUS_LABEL } from "@/lib/crm";
import { getPitches } from "@/lib/pitch-store";
import { csvCell, SITE_LABEL } from "@/lib/format";
import { allow } from "@/lib/ratelimit";
import { getLabels, getLeadsUnlocked } from "@/lib/search";

export const runtime = "nodejs";

/** CSV с открытыми лидами текущего пользователя. Чужие и неоткрытые контакты сюда не попадают. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Войдите в аккаунт", { status: 401 });
  if (!(await allow(`export:${user.id}`, 30, 3600))) return new Response("Слишком много выгрузок, попробуйте позже", { status: 429 });

  const ids = await listUnlockedIds(user.id, 5000);
  const labels = await getLabels();
  const leads: Awaited<ReturnType<typeof getLeadsUnlocked>> = [];
  for (let i = 0; i < ids.length; i += 400) leads.push(...(await getLeadsUnlocked(ids.slice(i, i + 400))));
  const crm = new Map<string, { status: string; note: string }>();
  for (let i = 0; i < ids.length; i += 400) for (const [k, v] of await getCrm(user.id, ids.slice(i, i + 400))) crm.set(k, v);

  const pitches = new Map<string, { message: string }>();
  for (let i = 0; i < ids.length; i += 400) for (const [k, v] of await getPitches(user.id, ids.slice(i, i + 400))) pitches.set(k, v);

  const head = ["Название", "Ниша", "Город", "Адрес", "Телефон", "E-mail", "Сайт", "Соцсети", "Статус сайта", "Оценка", "Что предложить", "Этап", "Заметка", "Питч"];
  const lines = [head.join(";")];
  for (const l of leads) {
    const c = crm.get(l.id);
    lines.push(
      [
        l.name, labels.niches[l.niche] ?? l.niche, l.city, l.address, l.phone, l.email, l.website, l.socials.join(" "),
        SITE_LABEL[l.siteKind], l.score, l.services.map((s) => labels.services[s] ?? s).join(", "),
        STATUS_LABEL[c?.status ?? "new"], c?.note ?? "", pitches.get(l.id)?.message ?? "",
      ].map(csvCell).join(";"),
    );
  }
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="findwork-leads.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}

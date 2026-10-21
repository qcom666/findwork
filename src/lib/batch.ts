import { unlockedAmong } from "./credits";
import { BATCH_SIZE } from "./limits";
import { makePitch, type Channel, type Profile } from "./pitch";
import { savePitch } from "./pitch-store";
import { getLabels, getLeadsUnlocked } from "./search";

export const BATCH_MAX = BATCH_SIZE;
const CONCURRENCY = 3;

export type BatchItem =
  | { id: string; ok: true; service: string; source: "claude" | "template" }
  | { id: string; ok: false; error: string };

/**
 * Пишет и сохраняет питчи для нескольких уже открытых лидов.
 * service: id услуги или "auto", тогда под каждое заведение берётся первая подсказка из его списка услуг.
 * Лиды, которые пользователь не открывал, пропускаются, их контакты и данные сюда не попадают.
 */
export async function generateBatch(opts: {
  userId: number;
  ids: string[];
  service: string;
  channel: Channel;
  profile: Profile;
}): Promise<BatchItem[]> {
  const ids = [...new Set(opts.ids)].slice(0, BATCH_MAX);
  const open = await unlockedAmong(opts.userId, ids);
  const leads = await getLeadsUnlocked(ids.filter((i) => open.has(i)));
  const labels = await getLabels();
  const byId = new Map(leads.map((l) => [l.id, l]));
  const results: BatchItem[] = [];

  const work = ids.map((id) => async (): Promise<BatchItem> => {
    const lead = byId.get(id);
    if (!lead) return { id, ok: false, error: "Заведение не открыто или не найдено" };
    const chosen = opts.service !== "auto" && labels.services[opts.service] ? opts.service : lead.services[0] ?? "site";
    try {
      const out = await makePitch({
        lead, nicheLabel: labels.niches[lead.niche] ?? lead.niche, serviceLabel: labels.services[chosen] ?? chosen,
        channel: opts.channel, profile: opts.profile, audit: null,
      });
      await savePitch(opts.userId, id, { service: chosen, channel: opts.channel, ...out.pitch, source: out.source });
      return { id, ok: true, service: chosen, source: out.source };
    } catch (e) {
      console.error("[batch] pitch failed", id, e);
      return { id, ok: false, error: "Не удалось написать питч" };
    }
  });

  // Небольшой пул: быстрее, чем по одному, и не бьёт по лимитам модели.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, work.length) }, async () => {
      while (next < work.length) {
        const i = next++;
        results[i] = await work[i]();
      }
    }),
  );
  return results;
}

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AuditResult } from "./audit";
import type { Lead } from "./search";

export type Profile = { name: string; skills: string; portfolio: string; priceFrom: string };
export type Channel = "telegram" | "whatsapp" | "email" | "call";

export type PitchRequest = {
  lead: Lead;
  nicheLabel: string;
  serviceLabel: string;
  channel: Channel;
  profile: Profile;
  audit?: AuditResult | null;
};

const PitchSchema = z.object({
  subject: z.string().describe("Тема письма. Для мессенджеров и звонка — пустая строка."),
  message: z.string().describe("Текст первого сообщения или короткий скрипт звонка."),
  followup: z.string().describe("Короткое напоминание, если ответа нет через 3–4 дня."),
  angle: z.string().describe("Одной строкой для фрилансера: на чём построен заход и что проверить перед отправкой."),
});
export type Pitch = z.infer<typeof PitchSchema>;

const SYSTEM = `Ты помогаешь российскому фрилансеру написать первое сообщение владельцу небольшого бизнеса.

Правила:
- Пиши по-русски, на «вы», спокойным деловым тоном. Без восторгов, без капса, без восклицательных знаков.
- Длина: мессенджер до 70 слов, e-mail до 120 слов, звонок — 3–4 коротких реплики.
- Опирайся только на блок ДАННЫЕ. Не выдумывай факты, кейсы, цены, сроки и цифры. Цену называй, только если она указана в профиле фрилансера.
- Данные взяты из открытых источников и могут быть неполными. Если сайта в данных нет, пиши «не нашёл ссылку на сайт в открытых источниках», а не «у вас нет сайта». Если есть результаты аудита, можно ссылаться на них как на проверенное.
- Одно конкретное предложение и один простой следующий шаг в виде вопроса.
- В конце вежливая фраза, что сообщение можно проигнорировать, если тема неактуальна.
- Не подписывайся придуманным именем: используй имя из профиля, а если его нет, оставь «[Имя]».
- Если ссылки на портфолио нет, не упоминай портфолио.`;

function describe(r: PitchRequest): string {
  const l = r.lead;
  const lines = [
    `Заведение: ${l.name}`,
    `Ниша: ${r.nicheLabel}`,
    l.city ? `Город: ${l.city}` : null,
    l.address ? `Адрес: ${l.address}` : null,
    `Сайт в открытых данных: ${l.website ?? "нет"}`,
    `Соцсети в открытых данных: ${l.socials.length ? l.socials.join(", ") : "нет"}`,
    `Услуга, которую предлагаем: ${r.serviceLabel}`,
    `Канал: ${{ telegram: "Telegram", whatsapp: "WhatsApp", email: "e-mail", call: "звонок" }[r.channel]}`,
  ];
  if (r.audit) {
    lines.push("Результаты проверки сайта:");
    for (const f of r.audit.findings) if (f.level !== "ok") lines.push(`- ${f.text}`);
  }
  const p = r.profile;
  lines.push(
    "",
    "ПРОФИЛЬ ФРИЛАНСЕРА",
    `Имя: ${p.name || "не указано"}`,
    `Что делает: ${p.skills || "не указано"}`,
    `Портфолио: ${p.portfolio || "нет ссылки"}`,
    `Цена от: ${p.priceFrom || "не указана"}`,
  );
  return "ДАННЫЕ\n" + lines.filter((x) => x !== null).join("\n");
}

export function templatePitch(r: PitchRequest): Pitch {
  const { lead: l, profile: p } = r;
  const who = p.name || "[Имя]";
  const siteLine =
    l.siteKind === "none" || l.siteKind === "social"
      ? "Не нашёл ссылку на ваш сайт в открытых источниках."
      : l.siteKind === "builder"
        ? "Увидел, что сайт у вас на бесплатном домене конструктора."
        : r.audit?.reachable
          ? "Открыл ваш сайт."
          : "Нашёл ваш сайт в открытых источниках.";
  const audit = r.audit?.findings.find((f) => f.level === "bad" || f.level === "warn");
  const hook = audit ? ` Заметил: ${audit.text.charAt(0).toLowerCase()}${audit.text.slice(1)}.` : "";
  const price = p.priceFrom ? ` Стоимость от ${p.priceFrom}.` : "";
  const port = p.portfolio ? ` Примеры работ: ${p.portfolio}.` : "";
  const opt = "Если тема неактуальна, просто не отвечайте, больше не побеспокою.";
  const body = `Здравствуйте! Меня зовут ${who}, занимаюсь услугой «${r.serviceLabel}». ${siteLine}${hook} Могу взять это на себя для «${l.name}».${price}${port} Удобно коротко обсудить, что вам нужно? ${opt}`;
  return {
    subject: r.channel === "email" ? `${r.serviceLabel} для «${l.name}»` : "",
    message: body,
    followup: `Здравствуйте! Напомню про сообщение выше. Если вопрос неактуален, дайте знать, и я не буду писать. ${who}`,
    angle: "Шаблон без ИИ: добавьте ANTHROPIC_API_KEY, чтобы текст подстраивался под заведение. Перед отправкой проверьте на карте, что сайта правда нет.",
  };
}

export async function makePitch(r: PitchRequest): Promise<{ pitch: Pitch; source: "claude" | "template"; note?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { pitch: templatePitch(r), source: "template" };

  const client = new Anthropic();
  try {
    const res = await client.messages.parse({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: describe(r) }],
      output_config: { effort: "low", format: zodOutputFormat(PitchSchema) },
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) {
      return { pitch: templatePitch(r), source: "template", note: "Модель не вернула текст, показан шаблон." };
    }
    return { pitch: res.parsed_output, source: "claude" };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError)
      return { pitch: templatePitch(r), source: "template", note: "Ключ Anthropic не подошёл, показан шаблон." };
    if (e instanceof Anthropic.RateLimitError)
      return { pitch: templatePitch(r), source: "template", note: "Лимит запросов к модели, показан шаблон." };
    if (e instanceof Anthropic.APIError)
      return { pitch: templatePitch(r), source: "template", note: `Ошибка модели (${e.status}), показан шаблон.` };
    throw e;
  }
}

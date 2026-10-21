import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { aiPitches, pitchFeature } from "../src/lib/ai";
import { makePitch } from "../src/lib/pitch";
import type { Lead } from "../src/lib/search";

const keep = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (keep === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = keep;
});

const lead = {
  id: "l1", name: "Студия «Лотос»", niche: "beauty", category: null, city: "Казань", address: null, lat: null, lon: null, siteKind: "none", isChain: false,
  confidence: 0.9, sources: [], score: 80, services: ["site"], unlocked: true, claimedUntil: null, has: { phone: true, email: false, social: false, website: false },
  preview: { phone: null, email: null, socials: [] }, phone: "+79001112233", phones: ["+79001112233"], email: null, website: null, socials: [],
} as unknown as Lead;

describe("питчи без ключа Anthropic", () => {
  it("о Claude в тарифах и на лендинге говорим только при подключённом ключе", () => {
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(aiPitches(), false);
    assert.equal(pitchFeature(), "Готовый питч под каждое заведение");
    process.env.ANTHROPIC_API_KEY = "   ";
    assert.equal(aiPitches(), false, "пустой ключ не считается");
    process.env.ANTHROPIC_API_KEY = "sk-test";
    assert.equal(aiPitches(), true);
    assert.equal(pitchFeature(), "Питч от Claude под каждое заведение");
  });

  it("шаблонный питч не показывает покупателю служебных подсказок про ключ", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const out = await makePitch({ lead, nicheLabel: "Салоны красоты", serviceLabel: "Сайт", channel: "telegram", profile: { name: "Алексей", skills: "", portfolio: "", priceFrom: "" }, audit: null });
    assert.equal(out.source, "template");
    assert.ok(!/ANTHROPIC|ключ/i.test(out.pitch.angle), out.pitch.angle);
    assert.ok(out.pitch.message.includes("Лотос"));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchNiches } from "../src/lib/niche-search";
import { mailtoUrl, mobileNumber, telegramUrl, telUrl, whatsappUrl } from "../src/lib/send";

const NICHES = [
  ["food", "Кафе и рестораны"], ["bars", "Бары, кальянные, клубы"], ["beauty", "Салоны красоты"], ["medical", "Клиники и стоматология"],
  ["auto", "Автосервис и авто"], ["ads", "Реклама, полиграфия, вывески"], ["business", "Бизнес-услуги и IT"], ["shops", "Магазины (разное)"],
  ["education", "Курсы, детские центры, автошколы"], ["build", "Строительство и ремонт"], ["repair", "Ремонт техники и бытовые услуги"], ["gifts", "Цветы, подарки, игрушки"],
].map(([id, label]) => ({ id, label }));

describe("поиск по своей нише", () => {
  it("находит нишу по слову, которого нет в списке ниш", () => {
    assert.deepEqual(matchNiches("вывески", NICHES), ["ads"]);
    assert.deepEqual(matchNiches("изготовление вывесок", NICHES), ["ads"]);
    assert.deepEqual(matchNiches("стоматология", NICHES), ["medical"]);
    assert.deepEqual(matchNiches("барбершоп", NICHES), ["beauty"]);
    assert.deepEqual(matchNiches("кофейня", NICHES), ["food"]);
  });
  it("слово из названия ниши тоже работает", () => {
    assert.deepEqual(matchNiches("кафе", NICHES), ["food"]);
    assert.deepEqual(matchNiches("салоны", NICHES), ["beauty"]);
    assert.deepEqual(matchNiches("клиники", NICHES), ["medical"]);
  });
  it("короткое «бар» совпадает только целым словом и не цепляет барбершоп", () => {
    assert.deepEqual(matchNiches("бар", NICHES), ["bars"]);
    assert.ok(!matchNiches("барбершоп", NICHES).includes("bars"));
  });
  it("слово из нескольких ниш даёт все подходящие, неизвестное и пустое ничего", () => {
    assert.deepEqual(matchNiches("ремонт", NICHES).sort(), ["build", "repair"]);
    assert.deepEqual(matchNiches("ксенон", NICHES), []);
    assert.deepEqual(matchNiches("", NICHES), []);
    assert.deepEqual(matchNiches('"; DROP TABLE places; --', NICHES), []);
  });
  it("ниши, которых нет в каталоге, не возвращаются", () => {
    assert.deepEqual(matchNiches("вывески", NICHES.filter((n) => n.id !== "ads")), []);
  });
});

describe("отправка в один клик", () => {
  const phones = ["+78432485816", "+79872319936"];
  it("берёт мобильный номер, городской пропускает", () => {
    assert.equal(mobileNumber(phones), "79872319936");
    assert.equal(mobileNumber(["+78432485816"]), null);
    assert.equal(mobileNumber([]), null);
  });
  it("WhatsApp: номер без плюса и текст в адресе", () => {
    assert.equal(whatsappUrl(phones, "Привет & пока?"), "https://wa.me/79872319936?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%26%20%D0%BF%D0%BE%D0%BA%D0%B0%3F");
    assert.equal(whatsappUrl(["+78432485816"], "x"), null);
  });
  it("Telegram: ссылка по номеру, без текста", () => {
    assert.equal(telegramUrl(phones), "https://t.me/+79872319936");
    assert.equal(telegramUrl(["+78432485816"]), null);
  });
  it("почта и звонок", () => {
    assert.equal(mailtoUrl("a@b.ru", "Тема", "Текст\nвторая строка"), "mailto:a@b.ru?subject=%D0%A2%D0%B5%D0%BC%D0%B0&body=%D0%A2%D0%B5%D0%BA%D1%81%D1%82%0A%D0%B2%D1%82%D0%BE%D1%80%D0%B0%D1%8F%20%D1%81%D1%82%D1%80%D0%BE%D0%BA%D0%B0");
    assert.equal(mailtoUrl(null, "t", "b"), null);
    assert.equal(telUrl(phones), "tel:+78432485816");
    assert.equal(telUrl([]), null);
  });
});

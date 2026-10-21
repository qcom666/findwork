/**
 * Поиск по своей нише: человек пишет «вывески», «стоматология» или «барбершоп», а каталог показывает и заведения
 * с таким словом в названии, и всю подходящую нишу. Каталог статичный, поэтому «своя ниша» здесь означает умное
 * сопоставление слов с нишами, а не сбор новых данных.
 */

type NicheRef = { id: string; label: string };

/** Основы слов (по началу) -> ниши. Основа «бар» совпадает только целым словом, чтобы не цеплять «барбершоп». */
const SYNONYMS: [string, string[]][] = [
  ["вывеск", ["ads"]], ["наружн", ["ads"]], ["реклам", ["ads"]], ["полиграф", ["ads"]], ["типограф", ["ads"]],
  ["баннер", ["ads"]], ["печат", ["ads"]], ["шелкограф", ["ads"]], ["сувенир", ["ads", "gifts"]],
  ["кафе", ["food"]], ["ресторан", ["food"]], ["кофейн", ["food"]], ["пиццер", ["food"]], ["пицц", ["food"]], ["суши", ["food"]],
  ["пекарн", ["food"]], ["булочн", ["food"]], ["столов", ["food"]], ["фастфуд", ["food"]], ["доставк", ["food"]], ["общепит", ["food"]],
  ["бар", ["bars"]], ["кальян", ["bars"]], ["паб", ["bars"]], ["клуб", ["bars"]], ["караоке", ["bars"]], ["пив", ["bars"]],
  ["салон", ["beauty"]], ["красот", ["beauty"]], ["парикмах", ["beauty"]], ["барбер", ["beauty"]], ["маникюр", ["beauty"]],
  ["ногт", ["beauty"]], ["космет", ["beauty"]], ["массаж", ["beauty"]], ["тату", ["beauty"]], ["спа", ["beauty"]], ["эпиляц", ["beauty"]],
  ["фитнес", ["fitness"]], ["йог", ["fitness"]], ["танц", ["fitness"]], ["тренаж", ["fitness"]], ["спортзал", ["fitness"]], ["бассейн", ["fitness"]],
  ["стомат", ["medical"]], ["зуб", ["medical"]], ["клиник", ["medical"]], ["врач", ["medical"]], ["медицин", ["medical"]], ["лаборатор", ["medical"]],
  ["ветеринар", ["vet"]], ["зоомагаз", ["vet"]], ["зоо", ["vet"]], ["животн", ["vet"]], ["груминг", ["vet"]],
  ["авто", ["auto"]], ["шиномонт", ["auto"]], ["мойк", ["auto"]], ["сто", ["auto"]], ["запчаст", ["auto"]], ["автосервис", ["auto"]], ["автошкол", ["education", "auto"]],
  ["отел", ["hotels"]], ["гостиниц", ["hotels"]], ["хостел", ["hotels"]], ["апартамент", ["hotels"]], ["баз", ["hotels"]],
  ["недвижим", ["realty"]], ["риелтор", ["realty"]], ["риэлтор", ["realty"]], ["застройщ", ["realty"]],
  ["юрист", ["legal"]], ["юридич", ["legal"]], ["адвокат", ["legal"]], ["нотариус", ["legal"]], ["бухгалт", ["legal"]], ["страхов", ["legal"]],
  ["ремонт", ["build", "repair"]], ["строит", ["build"]], ["отделк", ["build"]], ["клининг", ["build"]], ["уборк", ["build"]], ["сантехник", ["build"]],
  ["электрик", ["build"]], ["химчистк", ["repair"]], ["прачечн", ["repair"]], ["ателье", ["repair"]], ["сервис", ["repair"]],
  ["курс", ["education"]], ["школ", ["education"]], ["репетитор", ["education"]], ["детск", ["education"]], ["садик", ["education"]], ["обучен", ["education"]],
  ["праздник", ["events"]], ["свадьб", ["events"]], ["мероприят", ["events"]], ["банкет", ["events"]], ["квест", ["events"]],
  ["тур", ["travel"]], ["путешеств", ["travel"]], ["экскурс", ["travel"]], ["турагент", ["travel"]],
  ["одежд", ["fashion"]], ["обув", ["fashion"]], ["ювелир", ["fashion"]], ["бутик", ["fashion"]], ["оптик", ["fashion"]],
  ["мебел", ["home"]], ["сантехн", ["home"]], ["стройматериал", ["home"]], ["товары для дома", ["home"]],
  ["цвет", ["gifts"]], ["подар", ["gifts"]], ["игруш", ["gifts"]], ["книжн", ["gifts"]],
  ["электрон", ["electronics"]], ["телефон", ["electronics"]], ["компьютер", ["electronics"]], ["техник", ["electronics"]],
  ["магазин", ["shops"]], ["юристы", ["legal"]], ["консалт", ["business"]], ["фотограф", ["business"]], ["дизайн", ["business"]], ["айти", ["business"]],
  ["коворкинг", ["business"]],
];
const WHOLE_WORD = new Set(["бар", "сто", "спа", "баз", "паб", "тур", "зоо", "тату"]);

function tokens(q: string): string[] {
  return (q.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 6);
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Какие ниши подходят под запрос. Пустой список: ничего особенного, ищем только по названию. */
export function matchNiches(q: string, niches: NicheRef[]): string[] {
  const have = new Set(niches.map((n) => n.id));
  const hit = new Set<string>();
  for (const tok of tokens(q)) {
    if (tok.length < 3 && tok !== "бар") continue;
    for (const [stem, ids] of SYNONYMS) {
      const s = norm(stem);
      const ok = WHOLE_WORD.has(s) ? tok === s : tok.startsWith(s) && tok.length <= s.length + 7;
      if (ok) for (const id of ids) if (have.has(id)) hit.add(id);
    }
    // слова из названий ниш: «кафе», «салоны», «клиники»
    if (tok.length >= 4) {
      for (const n of niches) {
        for (const w of norm(n.label).match(/[\p{L}]{4,}/gu) ?? []) {
          if (w.startsWith(tok) || (tok.length >= 5 && tok.startsWith(w.slice(0, 5)))) hit.add(n.id);
        }
      }
    }
  }
  return [...hit];
}

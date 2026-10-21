"""Общие функции для сборки базы: нормализация названий, телефонов, ссылок и скоринг лидов."""
import re
from urllib.parse import urlparse

# ---------------------------------------------------------------- названия


_LEGAL = re.compile(r"\b(ооо|оао|зао|пао|ип|ao|llc|ltd|inc|кафе-бар|магазин)\b", re.I)
_PUNCT = re.compile(r"[^0-9a-zа-я\s]+", re.I)


def norm_name(name: str) -> str:
    s = (name or "").lower().replace("ё", "е")
    s = _LEGAL.sub(" ", s)
    s = _PUNCT.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------- телефоны


def norm_phone(raw):
    """Приводит российский номер к +7XXXXXXXXXX. Всё, что не похоже на номер РФ, отбрасывает."""
    if not raw:
        return None
    # в OSM несколько номеров бывают через «;»
    digits = re.sub(r"\D", "", str(raw).split(";")[0])
    if len(digits) == 11 and digits[0] in "78":
        digits = digits[1:]
    elif len(digits) == 10:
        pass
    else:
        return None
    if digits[0] not in "3489":  # коды РФ: 3xx, 4xx, 8xx, 9xx
        return None
    return "+7" + digits


# ---------------------------------------------------------------- ссылки

SOCIAL = {
    "vk.com", "vk.ru", "m.vk.com", "vkontakte.ru", "instagram.com", "facebook.com", "fb.com", "fb.me", "ok.ru",
    "t.me", "telegram.me", "telegram.org", "wa.me", "whatsapp.com", "api.whatsapp.com", "youtube.com", "youtu.be",
    "twitter.com", "x.com", "tiktok.com", "linkedin.com", "pinterest.com", "dzen.ru", "zen.yandex.ru", "vkvideo.ru",
    "rutube.ru", "max.ru",
}
AGGREGATOR = {
    "2gis.ru", "2gis.com", "go.2gis.com", "yandex.ru", "yandex.com", "ya.ru", "maps.google.com", "google.com",
    "goo.gl", "g.page", "maps.app.goo.gl", "zoon.ru", "flamp.ru", "tripadvisor.ru", "tripadvisor.com", "booking.com",
    "ostrovok.ru", "yell.ru", "orgpage.ru", "spravker.ru", "restoclub.ru", "afisha.ru", "avito.ru", "profi.ru",
    "yclients.com", "dikidi.net", "dikidi.ru", "restoran.ru", "tury.ru", "101hotels.com", "hotellook.com",
    "pokupki.market.yandex.ru", "market.yandex.ru", "uslugi.yandex.ru", "eda.yandex.ru", "delivery-club.ru",
    "foursquare.com", "wikipedia.org", "wikimapia.org", "apteka.ru", "gorzdrav.org", "prodoctorov.ru",
    "napopravku.ru", "docdoc.ru", "sbermarket.ru", "wildberries.ru", "ozon.ru",
}
# бесплатные домены конструкторов и «визитки-ссылки»: сайт есть, но это не собственный сайт бизнеса
BUILDER_SUFFIXES = (
    "tilda.ws", "tilda.cc", "wixsite.com", "wix.com", "nethouse.ru", "nethouse.id", "ucoz.ru", "ucoz.com", "ucoz.net",
    "ucoz.org", "narod.ru", "narod2.ru", "jimdofree.com", "jimdo.com", "weebly.com", "godaddysites.com",
    "business.site", "blogspot.com", "wordpress.com", "setup.ru", "mystrikingly.com", "carrd.co", "bitrix24.site",
    "bitrix24.ru", "sites.google.com", "flexbe.ru", "webnode.ru", "webnode.com", "my1.ru", "clients.site",
    "myshopify.com", "myinsales.ru", "ukit.me", "ukit.com", "taplink.cc", "taplink.ws", "linktr.ee", "hipolink.net",
    "bio.site", "lnk.bio", "beacons.ai", "turbo.site", "site123.me", "yolasite.com", "fo.ru", "wmsite.ru",
    "umi.ru", "ru.tilda.ws", "u-sites.ru", "do.am", "3dn.ru", "at.ua", "p1.ru", "mycdn.me", "sibirix.ru",
)


def domain_of(url: str):
    if not url:
        return None
    u = url.strip()
    if "://" not in u:
        u = "http://" + u
    try:
        host = (urlparse(u).hostname or "").lower()
    except ValueError:
        return None
    host = host.removeprefix("www.")
    return host if "." in host else None


def _matches(host: str, domains) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains)


def classify_url(url: str):
    """-> (kind, host). kind: social | aggregator | builder | real | None"""
    host = domain_of(url)
    if not host:
        return None, None
    if _matches(host, SOCIAL):
        return "social", host
    if _matches(host, AGGREGATOR):
        return "aggregator", host
    if _matches(host, BUILDER_SUFFIXES):
        return "builder", host
    return "real", host


def clean_url(url: str):
    u = (url or "").strip()
    if not u:
        return None
    if "://" not in u:
        u = "http://" + u
    return u


# ---------------------------------------------------------------- скоринг и услуги

SERVICES = {
    "site": "Сайт-визитка или лендинг",
    "redesign": "Редизайн / переезд на свой домен",
    "mobile": "Мобильная версия сайта",
    "qr_menu": "QR-меню и онлайн-заказ",
    "booking": "Онлайн-запись",
    "smm": "Ведение соцсетей",
    "logo": "Логотип и фирменный стиль",
    "seo": "SEO и карточки на картах",
    "shop": "Интернет-магазин",
}


def lead_services(site_kind: str, has_social: bool, niche_flags: set):
    out = []
    if site_kind in ("none", "social"):
        out.append("shop" if "retail" in niche_flags else "site")
    elif site_kind == "builder":
        out.append("redesign")
    if "food" in niche_flags:
        out.append("qr_menu")
    if "booking" in niche_flags:
        out.append("booking")
    if not has_social:
        out.append("smm")
    if site_kind in ("none", "builder"):
        out.append("logo")
    out.append("seo")
    seen, res = set(), []
    for s in out:
        if s not in seen:
            seen.add(s)
            res.append(s)
    return res[:5]


def lead_score(site_kind, has_phone, has_email, has_social, is_chain, confidence, ticket):
    """0..100. Чем сильнее потребность и чем проще связаться, тем выше."""
    s = {"none": 45, "social": 38, "builder": 28, "real": 0}[site_kind]
    s += 18 if has_phone else 0
    s += 7 if has_email else 0
    s += 5 if has_social else 0
    s += ticket  # 0..12: тип бизнеса, где чек за работу выше
    if confidence is not None and confidence >= 0.8:
        s += 5
    if is_chain:
        s -= 45
    return max(0, min(100, int(round(s))))


# ---------------------------------------------------------------- города

# В Overture часть городов записана латиницей. Сводим к русским названиям, чтобы в фильтре не было дублей.
CITY_RU = {
    "Moscow": "Москва", "Moskva": "Москва", "Moskau": "Москва",
    "Saint Petersburg": "Санкт-Петербург", "St Petersburg": "Санкт-Петербург", "Sankt-Peterburg": "Санкт-Петербург",
    "Saint-Petersburg": "Санкт-Петербург", "St.Petersburg": "Санкт-Петербург", "St. Petersburg": "Санкт-Петербург",
    "Pietari": "Санкт-Петербург",
    "Yekaterinburg": "Екатеринбург", "Ufa": "Уфа", "Samara": "Самара", "Kaliningrad": "Калининград",
    "Novosibirsk": "Новосибирск", "Chelyabinsk": "Челябинск", "Sochi": "Сочи", "Adler": "Сочи",
    "Kazan": "Казань", "Kazan’": "Казань", "Krasnodar": "Краснодар", "Nizhny Novgorod": "Нижний Новгород",
    "Perm": "Пермь", "Khimki": "Химки", "Vladivostok": "Владивосток", "Voronezh": "Воронеж", "Tolyatti": "Тольятти",
    "Irkutsk": "Иркутск", "Tomsk": "Томск", "Tver": "Тверь", "Tver'": "Тверь", "Krasnogorsk": "Красногорск",
    "Krasnoyarsk": "Красноярск", "Volgograd": "Волгоград", "Naberezhnye Chelny": "Набережные Челны",
    "Nizhnevartovsk": "Нижневартовск", "Tula": "Тула", "Rostov-on-Don": "Ростов-на-Дону", "Rostov": "Ростов-на-Дону",
    "Saratov": "Саратов", "Tyumen": "Тюмень", "Belgorod": "Белгород", "Petrozavodsk": "Петрозаводск",
    "Odintsovo": "Одинцово", "Yaroslavl": "Ярославль", "Mytishchi": "Мытищи", "Surgut": "Сургут", "Barnaul": "Барнаул",
    "Yakutsk": "Якутск", "Murmansk": "Мурманск", "Cheboksary": "Чебоксары", "Omsk": "Омск", "Gelendzhik": "Геленджик",
    "Kaluga": "Калуга", "Khabarovsk": "Хабаровск", "Izhevsk": "Ижевск", "Kemerovo": "Кемерово", "Kurgan": "Курган",
    "Lyubertsy": "Люберцы", "Makhachkala": "Махачкала", "Pyatigorsk": "Пятигорск", "Stavropol": "Ставрополь",
    "Syktyvkar": "Сыктывкар", "Ulyanovsk": "Ульяновск", "Pushkino": "Пушкино", "Ryazan": "Рязань",
    "Vladikavkaz": "Владикавказ", "Vladimir": "Владимир", "Kirov": "Киров", "Smolensk": "Смоленск",
    "Dmitrov": "Дмитров", "Istra": "Истра", "Domodedove": "Домодедово", "Domodedovo": "Домодедово",
}


def ru_city(name):
    return CITY_RU.get(name, name) if name else name

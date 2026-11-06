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
    "napopravku.ru", "docdoc.ru", "sbermarket.ru", "wildberries.ru", "ozon.ru", "moscowmap.ru", "spr.ru",
    "cataloxy.ru", "list-org.com", "rusprofile.ru", "zoon.com", "tiu.ru", "pulscen.ru", "blizko.ru",
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


def split_urls(value):
    """В OSM и других источниках несколько ссылок бывают в одном поле: «a.ru;https://vk.com/a», «a.ru, b.ru»."""
    return [p for p in re.split(r"[;,\s]+", value or "") if p]


# Бесплатная и провайдерская почта: адрес на таком домене ничего не говорит о сайте заведения.
# Почта на своём домене (info@cafe-romashka.ru) почти всегда значит, что сайт на этом домене тоже есть.
FREE_MAIL = {
    "gmail.com", "googlemail.com", "mail.ru", "bk.ru", "list.ru", "inbox.ru", "internet.ru", "xmail.ru", "mail.ua",
    "yandex.ru", "yandex.com", "yandex.by", "yandex.kz", "yandex.ua", "ya.ru", "narod.ru", "rambler.ru", "ro.ru",
    "lenta.ru", "autorambler.ru", "myrambler.ru", "rambler.ua", "icloud.com", "me.com", "mac.com", "outlook.com",
    "outlook.ru", "hotmail.com", "live.com", "live.ru", "msn.com", "yahoo.com", "ymail.com", "rocketmail.com",
    "aol.com", "proton.me", "protonmail.com", "pm.me", "tuta.io", "tutanota.com", "tutamail.com", "gmx.com",
    "gmx.net", "gmx.de", "mail.com", "zoho.com", "ngs.ru", "e1.ru", "ukr.net", "i.ua", "meta.ua", "bigmir.net",
    "qip.ru", "pochta.ru", "hotbox.ru", "nm.ru", "km.ru", "front.ru", "land.ru", "fromru.com", "newmail.ru",
    "inbox.lv", "tut.by", "sibmail.com", "rbcmail.ru", "mailru.com", "atlas.ru", "id.ru", "bigmir.ua",
}


# Домены второго уровня, на которых регистрируют сайты организаций: company.msk.ru — свой домен, а не ящик провайдера
GEO_SLD = {"msk.ru", "spb.ru", "com.ru", "org.ru", "net.ru", "pp.ru", "msk.su", "spb.su"}


def email_site(email):
    """
    Сайт по домену почты: info@ortob.ru -> https://ortob.ru. Бесплатная почта, соцсети и справочники -> None.
    Домены третьего уровня (kurgan.isp.ru, mail.ur.ru) — обычно ящики у провайдера, кроме company.msk.ru и подобных.
    """
    dom = (email or "").rsplit("@", 1)[-1].strip().lower().rstrip(".")
    if "@" not in (email or "") or "." not in dom or _matches(dom, FREE_MAIL):
        return None
    labels = dom.split(".")
    if len(labels) > 3 or (len(labels) == 3 and ".".join(labels[1:]) not in GEO_SLD):
        return None
    kind, host = classify_url(dom)
    return f"https://{host}" if kind == "real" else None


# Домен прямо в названии: «Exist.ru», «RBT.ru», «Зоооптторг.рф». Латинский домен — латинские метки, «.рф» — кириллические.
_NAME_DOMAIN = re.compile(
    r"(?<![\w.@-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:ru|su|com|net|org|pro|shop|store|online|info|biz|io|me|moscow|spb)"
    r"|(?:[а-яё0-9](?:[а-яё0-9-]*[а-яё0-9])?\.)+рф)(?![\w.-])",
    re.I,
)


def name_site(name):
    """Сайт по домену в названии заведения или None."""
    m = _NAME_DOMAIN.search(name or "")
    if not m:
        return None
    kind, host = classify_url(m.group(1).lower())
    return f"https://{host}" if kind == "real" else None


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
    "signage": "Вывеска и наружная реклама",
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
    if "storefront" in niche_flags and site_kind != "real":
        out.append("signage")
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
    return res[:6]


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

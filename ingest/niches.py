"""Ниши для фрилансеров: к какой нише отнести заведение из Overture (taxonomy) и из OSM (key=value).

ticket (0..12) — условный «средний чек работы»: у клиники и отеля он выше, чем у ларька.
flags управляют подсказками услуг: food -> QR-меню, booking -> онлайн-запись, retail -> интернет-магазин.
Всё, чего нет в списках (банки, почта, АЗС, госучреждения, школы, парки, памятники), в базу не попадает.
"""

NICHES = {
    "food": dict(label="Кафе и рестораны", ticket=6, flags={"food"},
                 slugs={"restaurant", "cafe", "coffee_shop", "fast_food_restaurant", "bakery", "food_and_drink",
                        "pizza_delivery_service", "tea_room", "ice_cream_shop", "dessert_shop", "juice_bar",
                        "diner", "buffet_restaurant", "food_court", "catering_service", "bistro"},
                 subs=["_restaurant", "_cafe", "bakery", "food_truck"]),
    "bars": dict(label="Бары, кальянные, клубы", ticket=6, flags={"food"},
                 slugs={"bar", "pub", "beer_bar", "hookah_bar", "lounge", "dance_club", "karaoke_venue", "nightclub",
                        "wine_bar", "cocktail_bar", "sports_bar", "brewery"},
                 subs=["_bar", "nightlife"]),
    "beauty": dict(label="Салоны красоты", ticket=8, flags={"booking"},
                   slugs={"beauty_salon", "hair_salon", "barber", "nail_salon", "tattoo_and_piercing", "spa",
                          "massage", "massage_therapy", "cosmetic_and_beauty_supplies", "eyebrow_service",
                          "makeup_artist", "skin_care", "day_spa", "hair_removal", "tanning_salon", "wellness_service"},
                   subs=["beauty", "hair_", "_spa", "massage", "nail_"]),
    "fitness": dict(label="Фитнес, йога, танцы", ticket=8, flags={"booking"},
                    slugs={"gym", "yoga_studio", "dance_studio", "sport_or_fitness_facility", "swimming_pool",
                           "martial_arts_club", "pilates_studio", "crossfit", "sports_and_recreation", "boxing_gym",
                           "sports_club_and_league"},
                    subs=["fitness", "_gym", "martial"]),
    "medical": dict(label="Клиники и стоматология", ticket=12, flags={"booking"},
                    slugs={"dental_clinic", "doctors_office", "health_care", "outpatient_care_facility",
                           "laboratory_testing", "alternative_medicine", "dentist", "cosmetic_surgeon", "psychologist",
                           "physical_therapy", "optometrist", "orthodontist", "medical_center", "clinic", "chiropractor",
                           "general_dentistry", "diagnostic_service", "urgent_care_clinic", "dermatologist"},
                    subs=["dentist", "clinic", "therap", "surgeon", "doctor"]),
    "vet": dict(label="Ветеринария и зоотовары", ticket=8, flags={"booking"},
                slugs={"veterinarian", "pet_store", "pet_groomer", "animal_hospital", "pet_boarding", "pet_sitting",
                       "animal_shelter", "pet_services"},
                subs=["pet_", "animal_"]),
    "auto": dict(label="Автосервис и авто", ticket=10, flags={"booking"},
                 slugs={"automotive_repair", "automotive_service", "auto_detailing", "car_wash", "auto_parts_store",
                        "auto_dealer", "tire_shop", "auto_glass_service", "car_dealer", "motorcycle_dealer",
                        "automotive", "auto_body_shop", "oil_change_station", "car_rental", "used_car_dealer",
                        "towing_service", "driving_school", "auto_customization", "automotive_parts_and_accessories"},
                 subs=["auto_", "car_", "tire", "vehicle", "automotive"]),
    "hotels": dict(label="Отели и хостелы", ticket=12, flags={"booking"},
                   slugs={"hotel", "lodging", "hostel", "bed_and_breakfast", "guest_house", "resort", "motel",
                          "inn", "campground", "vacation_rental", "apartment_hotel", "holiday_park", "cottage",
                          "recreation_base", "sanatorium"},
                   subs=["hotel", "lodging", "_inn", "guest"]),
    "realty": dict(label="Недвижимость", ticket=10, flags=set(),
                   slugs={"real_estate_service", "home_developer", "real_estate_agent", "property_management",
                          "real_estate_agency", "apartment_agent", "real_estate"},
                   subs=["real_estate", "property_"]),
    "legal": dict(label="Юристы, бухгалтеры, страхование", ticket=10, flags=set(),
                  slugs={"attorney_or_law_firm", "legal_service", "accountant", "accounting_service", "tax_service",
                         "notary", "insurance_agency", "financial_advisor", "bookkeeper", "lawyer", "notary_public",
                         "immigration_service", "debt_collection", "tax_preparation"},
                  subs=["legal", "attorney", "account", "insurance"]),
    "business": dict(label="Бизнес-услуги, реклама, IT", ticket=8, flags=set(),
                     slugs={"professional_service", "advertising_agency", "printing_service", "photographer",
                            "information_technology_company", "marketing_agency", "translation_service",
                            "business_consulting", "graphic_designer", "web_design", "recruiting_agency",
                            "photography_studio", "video_production", "coworking_space", "software_development",
                            "business_service", "consulting_service", "design_studio", "architecture_firm",
                            "business_management_consultant", "employment_agency", "payroll_service"},
                     subs=["consult", "marketing", "design", "photograph", "agency", "software"]),
    "build": dict(label="Строительство и ремонт", ticket=10, flags=set(),
                  slugs={"building_or_construction_service", "interior_design", "contractor", "plumber", "electrician",
                         "roofing", "cleaning_service", "moving_service", "landscaping", "home_service",
                         "construction_company", "painter", "hvac_service", "general_contractor", "carpenter",
                         "window_installation", "flooring", "locksmith", "home_cleaning", "pest_control_service",
                         "security_service", "waste_management"},
                  subs=["construction", "remodel", "contractor", "cleaning"]),
    "repair": dict(label="Ремонт техники и бытовые услуги", ticket=6, flags={"booking"},
                   slugs={"mobile_phone_repair", "computer_repair", "appliance_repair", "shoe_repair", "tailor",
                          "dry_cleaning", "laundry", "watch_repair", "key_and_lock_service", "electronics_repair",
                          "sewing_alteration", "repair_service", "photo_lab", "jewelry_repair", "funeral_service",
                          "dry_cleaning_and_laundry", "furniture_repair"},
                   subs=["repair", "laundry", "alteration"]),
    "education": dict(label="Курсы, детские центры, автошколы", ticket=8, flags={"booking"},
                      slugs={"language_school", "tutoring_service", "driving_school", "music_school", "preschool",
                             "day_care_preschool", "education", "art_school", "dance_school", "educational_service",
                             "child_care", "kindergarten", "vocational_school", "specialty_school", "cooking_school",
                             "test_preparation", "computer_training", "childrens_center", "training_center"},
                      subs=["tutor", "training", "_school"]),
    "events": dict(label="Мероприятия и развлечения", ticket=8, flags={"booking"},
                   slugs={"party_and_event_planning", "wedding_planning", "banquet_hall", "escape_room", "bowling_alley",
                          "event_or_party_service", "wedding_service", "event_venue", "amusement_attraction",
                          "paintball", "laser_tag", "quest_room", "trampoline_park", "children_party_service",
                          "rental_service", "party_supply", "event_photography"},
                   subs=["event", "wedding", "party"]),
    "travel": dict(label="Туризм и экскурсии", ticket=8, flags={"booking"},
                   slugs={"travel_service", "tour_operator", "travel_agency", "tourist_information", "sightseeing_tour",
                          "tour_guide", "boat_tour", "excursion"},
                   subs=["tour", "travel_a"]),
    "fashion": dict(label="Одежда, обувь, украшения", ticket=5, flags={"retail"},
                    slugs={"clothing_store", "womens_clothing_store", "mens_clothing_store", "childrens_clothing_store",
                           "shoe_store", "fashion_boutique", "jewelry_store", "eyewear_store", "fashion_and_apparel_store",
                           "bag_store", "accessories_store", "lingerie_store", "watch_store", "thrift_store",
                           "wedding_dress_store", "fur_store"},
                    subs=["clothing", "apparel", "boutique"]),
    "home": dict(label="Мебель и товары для дома", ticket=6, flags={"retail"},
                 slugs={"furniture_store", "home_goods_store", "hardware_store", "building_supply_store",
                        "home_improvement_store", "flooring_store", "kitchen_supply_store", "lighting_store",
                        "paint_store", "tile_store", "garden_center", "mattress_store", "curtain_store",
                        "plumbing_supply_store", "window_treatment_store", "appliance_store"},
                 subs=["furniture", "home_", "building_supply", "hardware"]),
    "gifts": dict(label="Цветы, подарки, игрушки", ticket=4, flags={"retail"},
                  slugs={"flowers_and_gifts_store", "toy_store", "bookstore", "florist", "gift_shop", "art_supply_store",
                         "stationery_store", "party_supply_store", "souvenir_shop", "hobby_shop", "craft_store"},
                  subs=["gift", "flower", "toy_"]),
    "electronics": dict(label="Электроника и телефоны", ticket=4, flags={"retail"},
                        slugs={"mobile_phone_store", "electronics_store", "computer_store", "camera_store",
                               "video_game_store", "mobile_phone_accessory_store", "audio_visual_store"},
                        subs=["electronic", "computer_"]),
    "shops": dict(label="Магазины (разное)", ticket=2, flags={"retail"},
                  slugs={"shopping", "specialty_store", "sporting_goods_store", "beauty_supply_store", "liquor_store",
                         "bicycle_shop", "tobacco_shop", "music_store", "antique_store", "outdoor_gear_store",
                         "fishing_store", "hunting_store", "wine_store", "tea_store", "cosmetics_store",
                         "optical_store", "organic_store", "natural_food_store", "vape_shop", "pawn_shop",
                         "musical_instrument_store", "second_hand_store", "convenience_store_specialty"},
                  subs=["_store", "_shop"]),
}

# слаги, которые подстрочные правила подцепили бы по ошибке: банки, госорганы, сети, инфраструктура
EXCLUDE = {
    "bank", "bank_or_credit_union", "atm", "post_office", "gas_station", "government_office", "hospital", "park",
    "school", "elementary_school", "middle_school", "high_school", "college_university", "campus_building", "library",
    "pharmacy", "grocery_store", "convenience_store", "supermarket", "shopping_mall", "department_store",
    "train_station", "bus_station", "airport", "monument", "historic_site", "museum", "christian_place_of_worship",
    "religious_organization", "town_hall", "courthouse", "police_station", "fire_station", "stadium_arena",
    "public_plaza", "community_center", "social_or_community_service", "cultural_center", "movie_theater",
    "theatre_venue", "music_venue", "arts_and_entertainment", "art_gallery", "history_museum", "sport_league",
    "lake", "river", "beach", "bridge", "amusement_park", "laboratory", "commercial_industrial", "industrial_company",
    "corporate_or_business_office", "financial_service", "cemetery", "public_toilet", "parking", "bus_stop",
    "ev_charging_station", "transportation", "travel_and_transportation", "community_and_government",
}

_exact = {}
for _nid, _n in NICHES.items():
    for _s in _n["slugs"]:
        _exact.setdefault(_s, _nid)
_subs = [(sub, nid) for nid, n in NICHES.items() if nid != "shops" for sub in n["subs"]]
_subs.append(("_store", "shops"))
_subs.append(("_shop", "shops"))


def niche_for_overture(category):
    if not category or category in EXCLUDE:
        return None
    if category in _exact:
        return _exact[category]
    for sub, nid in _subs:
        if sub in category:
            return nid
    return None


# OSM: ключ=значение или просто ключ с любым значением
_OSM_EXACT = {
    "shop=hairdresser": "beauty", "shop=beauty": "beauty", "shop=massage": "beauty", "shop=tattoo": "beauty",
    "shop=cosmetics": "beauty", "shop=nails": "beauty", "shop=perfumery": "shops",
    "shop=clothes": "fashion", "shop=shoes": "fashion", "shop=jewelry": "fashion", "shop=bag": "fashion",
    "shop=boutique": "fashion", "shop=fashion_accessories": "fashion", "shop=fabric": "fashion",
    "shop=watches": "fashion", "shop=optician": "fashion", "shop=tailor": "repair",
    "shop=florist": "gifts", "shop=gift": "gifts", "shop=toys": "gifts", "shop=books": "gifts",
    "shop=stationery": "gifts", "shop=art": "gifts", "shop=craft": "gifts", "shop=variety_store": "shops",
    "shop=furniture": "home", "shop=doityourself": "home", "shop=hardware": "home", "shop=houseware": "home",
    "shop=kitchen": "home", "shop=interior_decoration": "home", "shop=bathroom_furnishing": "home",
    "shop=lighting": "home", "shop=paint": "home", "shop=curtain": "home", "shop=carpet": "home",
    "shop=tiles": "home", "shop=flooring": "home", "shop=garden_centre": "home", "shop=bed": "home",
    "shop=electronics": "electronics", "shop=mobile_phone": "electronics", "shop=computer": "electronics",
    "shop=hifi": "electronics", "shop=appliance": "electronics", "shop=video_games": "electronics",
    "shop=car": "auto", "shop=car_repair": "auto", "shop=car_parts": "auto", "shop=tyres": "auto",
    "shop=motorcycle": "auto", "shop=bakery": "food", "shop=pastry": "food", "shop=confectionery": "food",
    "shop=coffee": "food", "shop=tea": "food", "shop=deli": "food", "shop=ice_cream": "food",
    "shop=alcohol": "shops", "shop=beverages": "shops", "shop=wine": "shops", "shop=sports": "shops",
    "shop=bicycle": "shops", "shop=pet": "vet", "shop=pet_grooming": "vet", "shop=copyshop": "business",
    "shop=photo": "business", "shop=laundry": "repair", "shop=dry_cleaning": "repair", "shop=travel_agency": "travel",
    "shop=musical_instrument": "shops", "shop=antiques": "shops", "shop=second_hand": "shops",
    "shop=ticket": "events", "shop=e-cigarette": "shops", "shop=tobacco": "shops", "shop=outdoor": "shops",
    "amenity=restaurant": "food", "amenity=cafe": "food", "amenity=fast_food": "food", "amenity=food_court": "food",
    "amenity=ice_cream": "food", "amenity=bar": "bars", "amenity=pub": "bars", "amenity=biergarten": "bars",
    "amenity=nightclub": "bars", "amenity=dentist": "medical", "amenity=clinic": "medical", "amenity=doctors": "medical",
    "amenity=veterinary": "vet", "amenity=car_wash": "auto", "amenity=car_repair": "auto",
    "amenity=driving_school": "education", "amenity=language_school": "education", "amenity=music_school": "education",
    "amenity=kindergarten": "education", "amenity=childcare": "education", "amenity=coworking_space": "business",
    "amenity=studio": "business", "amenity=spa": "beauty", "amenity=social_facility": None,
    "tourism=hotel": "hotels", "tourism=hostel": "hotels", "tourism=guest_house": "hotels", "tourism=apartment": "hotels",
    "tourism=motel": "hotels", "tourism=chalet": "hotels", "tourism=camp_site": "hotels",
    "leisure=fitness_centre": "fitness", "leisure=sports_centre": "fitness", "leisure=dance": "fitness",
    "leisure=swimming_pool": "fitness", "leisure=yoga": "fitness", "leisure=escape_game": "events",
    "leisure=bowling_alley": "events", "leisure=playground": None,
    "office=lawyer": "legal", "office=notary": "legal", "office=accountant": "legal", "office=tax_advisor": "legal",
    "office=insurance": "legal", "office=financial_advisor": "legal", "office=estate_agent": "realty",
    "office=travel_agent": "travel", "office=architect": "business", "office=advertising_agency": "business",
    "office=it": "business", "office=company": "business", "office=consulting": "business",
    "office=coworking": "business", "office=employment_agency": "business", "office=photo": "business",
    "office=surveyor": "build", "office=construction_company": "build", "office=educational_institution": "education",
    "office=government": None, "office=political_party": None, "office=ngo": None, "office=association": None,
    "office=diplomatic": None, "office=religion": None, "office=research": None,
}
_OSM_CRAFT = {
    "carpenter": "build", "electrician": "build", "plumber": "build", "painter": "build", "hvac": "build",
    "builder": "build", "roofer": "build", "glaziery": "build", "tiler": "build", "plasterer": "build",
    "floorer": "build", "handicraft": "gifts", "photographer": "business", "caterer": "food", "jeweller": "fashion",
    "tailor": "repair", "shoemaker": "repair", "key_cutter": "repair", "watchmaker": "repair",
    "electronics_repair": "repair", "locksmith": "repair", "upholsterer": "repair", "printer": "business",
    "sign_maker": "business", "brewery": "bars", "bakery": "food", "confectionery": "food",
}


def niche_for_osm(osm_key):
    if not osm_key:
        return None
    if osm_key in _OSM_EXACT:
        return _OSM_EXACT[osm_key]
    key, _, val = osm_key.partition("=")
    if key == "craft":
        return _OSM_CRAFT.get(val, "repair")
    if key == "office":
        return "business"
    if key == "healthcare":
        if val in ("pharmacy", "hospital", "blood_donation"):
            return None
        return "vet" if val == "veterinary" else "medical"
    if key == "shop":
        if val in ("vacant", "supermarket", "convenience", "mall", "department_store", "greengrocer", "kiosk",
                   "butcher", "seafood", "farm", "general", "chemist", "newsagent", "wholesale", "pawnbroker",
                   "bank", "money_lender", "bookmaker", "lottery", "funeral_directors"):
            return None
        return "shops"
    return None

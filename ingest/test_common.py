import unittest

from common import inactive_name, inactive_osm


class InactivePlaceTests(unittest.TestCase):
    def test_explicit_closed_markers(self):
        for name in ("Кафе (закрыто)", "Магазин не работает", "Closed barbershop", "Салон ликвидирован"):
            self.assertTrue(inactive_name(name), name)

    def test_real_names_are_not_false_positives(self):
        for name in ("Закрытый клуб", "Дом закрытой пиццы", "Закрытая школа"):
            self.assertFalse(inactive_name(name), name)

    def test_osm_lifecycle_tags(self):
        self.assertTrue(inactive_osm({"name": "Кафе", "disused": "yes"}))
        self.assertTrue(inactive_osm({"name": "Кафе", "abandoned:amenity": "restaurant"}))
        self.assertTrue(inactive_osm({"name": "Кафе", "opening_hours": "closed"}))
        self.assertTrue(inactive_osm({"name": "Кафе", "end_date": "2024"}))
        self.assertFalse(inactive_osm({"name": "Кафе", "end_date": "2099"}))
        self.assertFalse(inactive_osm({"name": "Кафе", "disused": "no", "opening_hours": "Mo-Su 10:00-22:00"}))


if __name__ == "__main__":
    unittest.main()

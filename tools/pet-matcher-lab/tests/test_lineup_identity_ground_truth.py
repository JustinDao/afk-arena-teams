import importlib.util
from pathlib import Path
import unittest


HELPER_PATH = Path(__file__).resolve().parents[1] / "create-lineup-identity-ground-truth.py"
SPEC = importlib.util.spec_from_file_location("lineup_identity_ground_truth", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Could not load identity-ground-truth helpers from {HELPER_PATH}.")
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


class HeroAssetUrlTests(unittest.TestCase):
    def test_default_ascension_matches_lineup_parser(self):
        catalog_entry = {"id": 52}
        cases = (
            ({"si": 30, "furniture": 0, "engraving": 0}, "52_m_si30.webp"),
            ({"si": 40, "furniture": 9, "engraving": 0}, "52_a_si40_f9.webp"),
            ({"si": 40, "furniture": 9, "engraving": 60}, "52_a1_si40_f9_e60.webp"),
            ({"si": 0, "furniture": 0, "engraving": 0}, "52_a_si0.webp"),
        )
        for hero, expected_filename in cases:
            with self.subTest(hero=hero):
                self.assertTrue(
                    HELPER.hero_asset_url(hero, catalog_entry).endswith(expected_filename)
                )

    def test_lineup_9_visual_state_overrides(self):
        cases = (
            (
                "molten-crystalline-worm-queen",
                {"slug": "rowan", "si": 30},
                {"id": 52},
                "52_a1_si30.webp",
            ),
            (
                "cindercrow-specter",
                {"slug": "awakened-safiya"},
                {"id": 165},
                "165_a1_si30_f9_e60.webp",
            ),
            (
                "cindercrow-specter",
                {"slug": "highborn-lan", "si": 40, "furniture": 9},
                {"id": 199},
                "199_a1_si40_f9.webp",
            ),
        )
        for formation_key, hero, catalog_entry, expected_filename in cases:
            with self.subTest(hero=hero["slug"]):
                url, source = HELPER.benchmark_hero_asset(
                    hero,
                    catalog_entry,
                    formation_key,
                )
                self.assertTrue(url.endswith(expected_filename))
                self.assertEqual(source, "screenshot_visual_override")


if __name__ == "__main__":
    unittest.main()

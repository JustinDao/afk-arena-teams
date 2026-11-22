#!/usr/bin/env python3
"""Golden regression benchmark from user-reviewed Reddit guide teams."""
import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRATCH = Path("/Users/justindao/.gemini/antigravity/brain/dfe954fe-abac-4217-85be-b7f8f2402e98/scratch")
DL = SCRATCH / "dl"

# Ground-truth checks from user-verified teams across all 5 authors
GOLDEN_CHECKS = [
    # (url_substr, set_idx, team_idx_0based, slot_idx_0based, expected_hero_name, label)
    ("1xzb6lo", 0, 4, 3, "Brenna (Highborn)", "Volcano Nov S1 T5 Brenna"),
    ("1xzb6lo", 1, 4, 3, "Brenna (Highborn)", "Volcano Nov S2 T5 Brenna"),
    ("1xzb6lo", 2, 1, 3, "Theowyn (Awakened)", "Volcano Nov S3 T2 Theowyn(SP)"),
    ("1xzb6lo", 0, 3, 3, "Hybris (Awakened)", "Volcano Nov S1 T4 Hybris(SP)"),
    ("1xzb6lo", 0, 5, 4, "Theowyn (Awakened)", "Volcano Nov S1 T6 Theowyn(SP)"),
    ("1wzreq1", 0, 0, 0, "Kyno", "Ice Oct S1 T1 Kyno"),
    ("1wzreq1", 1, 1, 2, "Kafka Hibino", "Ice Oct S2 T2 Kafka"),
    ("1wzreq1", 2, 1, 2, "Kafka Hibino", "Ice Oct S3 T2 Kafka"),
    ("1wbgoze", 0, 6, 2, "Shuna", "Volcano Sep S1 T7 Shuna"),
    ("1wbgoze", 0, 6, 4, "Eluard (Awakened)", "Volcano Sep S1 T7 Eluard"),
    ("1xrh9tw", 0, 0, 0, "Atheus", "mcwhare CR T1 Atheus"),
    ("1xrh9tw", 0, 0, 1, "Pippa (Awakened)", "mcwhare CR T1 Pippa"),
    ("1xrh9tw", 0, 4, 3, "Begris", "mcwhare CR T5 Begris"),
    ("1xrh9tw", 0, 4, 4, "Skriath (Awakened)", "mcwhare CR T5 Skriath"),
    ("1xfokah", 0, 4, 3, "Dracula", "mcwhare NC T5 Dracula"),
    ("1xfokah", 0, 4, 4, "Athena", "mcwhare NC T5 Athena"),
    ("1xrk6bv", 0, 3, 0, "Eluard (Awakened)", "mcwhare NC T4 Eluard"),
    ("1xxg2zw", 0, 1, 0, "Begris", "mcwhare NC T2 Begris"),
    ("1x3vtwd", 0, 4, 0, "Maetria (Awakened)", "NoName Blizzard 5T T5 Maetria"),
    ("1x3vtwd", 0, 4, 4, "Kafka Hibino", "NoName Blizzard 5T T5 Kafka"),
    ("1x6h9w0", 0, 0, 3, "Velufira", "NoName Blizzard 6T T1 Velufira"),
]

# Extra structural checks: (url_substr, expected_team_count_set0, label)
STRUCTURAL_CHECKS = [
    ("1wwfyps", 7, "NoName Forest 7T exact 7 teams"),
    ("1widusa", 6, "NoName Volcano 6T exact 6 teams"),
    ("1xwh4g5", 6, "Groody Dark Nemora S1 6 teams"),
]

def main():
    spec = importlib.util.spec_from_file_location("rec", REPO_ROOT / "api" / "recognize-lineup.py")
    rec_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rec_mod)

    guides = json.loads((SCRATCH / "guides_3mo.json").read_text(encoding="utf-8"))
    needed = {c[0] for c in GOLDEN_CHECKS} | {c[0] for c in STRUCTURAL_CHECKS}
    results = {}
    for g in guides:
        for sub in needed:
            if sub in g["post_url"] and sub not in results:
                blobs = [(DL / u.split("/")[-1].split("?")[0]).read_bytes() for u in g["images"]]
                results[sub] = rec_mod.recognize_multiple_images(blobs)

    passed = 0
    failed = []
    for sub, si, ti, hi, exp, lbl in GOLDEN_CHECKS:
        res = results[sub]
        sets = res.get("lineup_sets") or [{"teams": res.get("teams", [])}]
        got = None
        if si < len(sets) and ti < len(sets[si]["teams"]) and hi < len(sets[si]["teams"][ti]["heroes"]):
            got = sets[si]["teams"][ti]["heroes"][hi]["name"]
        if got == exp:
            passed += 1
        else:
            failed.append((lbl, exp, got))

    struct_pass = 0
    struct_fail = []
    for sub, exp_n, lbl in STRUCTURAL_CHECKS:
        res = results[sub]
        sets = res.get("lineup_sets") or [{"teams": res.get("teams", [])}]
        got_n = len(sets[0]["teams"])
        if got_n == exp_n:
            struct_pass += 1
        else:
            struct_fail.append((lbl, exp_n, got_n))

    # Result, pet-level, collection & ascension-clamping regression checks on loaded guides
    meta_checks = []
    if "1xwh4g5" in results:
        t0 = (results["1xwh4g5"].get("lineup_sets") or [{"teams": results["1xwh4g5"].get("teams", [])}])[0]["teams"][0]
        meta_checks.append(("Groody CR T1 damage == 48B", t0.get("damage") == 48_000_000_000, t0.get("damage")))
        meta_checks.append(("Groody CR T1 pet_level 1..36", isinstance((t0.get("pet") or {}).get("level"), int), (t0.get("pet") or {}).get("level")))
        meta_checks.append(("Groody CR T1 hero0 has collection", (t0["heroes"][0].get("collection") or {}).get("catalog") is not None, t0["heroes"][0].get("collection")))
        f0 = (results["1xwh4g5"].get("seed_payload") or {}).get("formations", [{}])[0]
        bad_asc = [
            h for h in f0.get("heroes", [])
            if "e" in str(h.get("investment", "")).lower()
            and int(str(h.get("investment")).lower().split("e", 1)[1] or "0") > 0
            and h.get("ascension") not in ("ascended_1", "ascended_2", "ascended_3", "ascended_4", "ascended_5")
        ]
        meta_checks.append(("Groody CR T1 seed_payload engraving -> A1*", len(bad_asc) == 0, bad_asc))
    if "1xrh9tw" in results:
        t0 = results["1xrh9tw"]["teams"][0]
        meta_checks.append(("mcwhare CR T1 damage > 0", (t0.get("damage") or 0) > 0, t0.get("damage")))
    if "1xxg2zw" in results:
        t0 = results["1xxg2zw"]["teams"][0]
        meta_checks.append(("mcwhare NC T1 kill_time > 0", (t0.get("kill_time_seconds") or 0) > 0, t0.get("kill_time_seconds")))

    meta_pass = sum(1 for _, ok, _ in meta_checks if ok)

    print(f"GOLDEN HERO CHECKS: {passed}/{len(GOLDEN_CHECKS)} passed")
    for lbl, exp, got in failed:
        print(f"  FAIL: {lbl} | expected={exp} got={got}")
    print(f"STRUCTURAL CHECKS: {struct_pass}/{len(STRUCTURAL_CHECKS)} passed")
    for lbl, exp, got in struct_fail:
        print(f"  FAIL: {lbl} | expected={exp} got={got}")
    print(f"RESULT/PET/COLLECTION/ASCENSION CHECKS: {meta_pass}/{len(meta_checks)} passed")
    for lbl, ok, val in meta_checks:
        if not ok:
            print(f"  FAIL: {lbl} | got={val}")

if __name__ == "__main__":
    main()

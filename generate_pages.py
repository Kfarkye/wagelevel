#!/usr/bin/env python3
"""
generate_pages.py — Normalize + enrich raw OFLC wage data into per-page
canonical JSON objects.

Pipeline: raw wage_data.json → normalize → enrich → database/json/*.json + manifest.json
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW_DATA = ROOT / "data" / "wage_data.json"
JSON_DIR = ROOT / "database" / "json"
MANIFEST_PATH = ROOT / "database" / "manifest.json"
CANONICAL_HOST = "https://www.wagelevel.fyi"

# ─── FY2027 Constants (sourced from 90 Fed. Reg. 60864) ───────────────────────
FY_LABEL = "FY2027"
REG_OPEN = "March 4, 2026 (12:00 PM ET)"
REG_CLOSE = "March 19, 2026 (12:00 PM ET)"
DHS_BASELINES = {
    "1": {"probability": 15.29, "entries": 1},
    "2": {"probability": 30.58, "entries": 2},
    "3": {"probability": 45.87, "entries": 3},
    "4": {"probability": 61.16, "entries": 4},
}

# ─── Curated Launch Set: 17 H-1B SOC codes ────────────────────────────────────
LAUNCH_SOCS = [
    "15-1252.00",  # Software Developers
    "15-1211.00",  # Computer Systems Analysts
    "15-1299.00",  # Computer Occupations, All Other
    "15-1244.00",  # Network and Computer Systems Administrators
    "15-1212.00",  # Information Security Analysts
    "15-1221.00",  # Computer and Information Research Scientists
    "15-1243.00",  # Database Architects
    "15-1241.00",  # Computer Network Architects
    "15-2051.00",  # Data Scientists
    "15-1251.00",  # Computer Programmers
    "11-3021.00",  # Computer and Information Systems Managers
    "13-1082.00",  # Project Management Specialists
    "13-1111.00",  # Management Analysts
    "13-2011.00",  # Accountants and Auditors
    "17-2061.00",  # Computer Hardware Engineers
    "17-2112.00",  # Industrial Engineers
    "29-1141.00",  # Registered Nurses
]

# ─── Curated Launch Set: 50 H-1B filing MSAs ──────────────────────────────────
LAUNCH_AREAS = [
    "41940", "41860", "35620", "47900", "16980", "26420", "19100", "33100",
    "12060", "42660", "14460", "38060", "31080", "37980", "19820", "33460",
    "12580", "40140", "41740", "36740", "45300", "40900", "38900", "34980",
    "29820", "28140", "26900", "18140", "17460", "16740", "39580", "40060",
    "41180", "41620", "19740", "38300", "12420", "17140", "47260", "27260",
    "17900", "24860", "46520", "36420", "32820", "15380", "36540", "35380",
    "10900", "24340",
]

TODAY = datetime.now().strftime("%Y-%m-%d")


# ─── Helpers ───────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    s = text.lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s-]+", "-", s)
    return s.strip("-")


def area_short_name(label: str) -> str:
    parts = label.rsplit(",", 1)
    if len(parts) == 2:
        first_city = parts[0].strip().split("-")[0].strip()
        first_state = parts[1].strip().split("-")[0].strip()
        return f"{first_city}, {first_state}"
    return label


def area_slug(label: str) -> str:
    return slugify(area_short_name(label))


def soc_slug(label: str) -> str:
    s = re.sub(r"\bAnd\b", "", label)
    return slugify(s)


def make_page_slug(soc_label: str, area_label: str) -> str:
    return f"{soc_slug(soc_label)}-{area_slug(area_label)}"


def generate_faq(soc_label: str, area_short: str, t: list[int]) -> list[dict]:
    return [
        {
            "question": f"What is the H-1B wage level for {soc_label} in {area_short}?",
            "answer": (
                f"Under the OEWS prevailing wage system, the four wage levels for "
                f"{soc_label} in {area_short} are: Level I ${t[0]:,}, Level II "
                f"${t[1]:,}, Level III ${t[2]:,}, and Level IV ${t[3]:,}. Your "
                f"H-1B registration wage level is determined by which threshold "
                f"your guaranteed wage meets or exceeds."
            ),
        },
        {
            "question": f"What are the H-1B lottery odds for {soc_label} in {area_short}?",
            "answer": (
                f"Under the DHS weighted selection model for {FY_LABEL}, baseline "
                f"probabilities are: Level I 15.29% (1 entry), Level II 30.58% "
                f"(2 entries), Level III 45.87% (3 entries), Level IV 61.16% "
                f"(4 entries). Actual outcomes depend on total registration volume "
                f"and wage-level distribution."
            ),
        },
        {
            "question": f"When is the {FY_LABEL} H-1B registration window?",
            "answer": (
                f"The USCIS {FY_LABEL} H-1B cap registration window opens "
                f"{REG_OPEN} and closes {REG_CLOSE}."
            ),
        },
    ]


# ─── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("Loading raw data...")
    raw = json.loads(RAW_DATA.read_text(encoding="utf-8"))

    soc_lookup = {s["code"]: s["label"] for s in raw["soc_codes"]}
    area_lookup = {a["code"]: a["label"] for a in raw["areas"]}
    wage_matrix = raw["wage_matrix"]

    # Clean output
    JSON_DIR.mkdir(parents=True, exist_ok=True)
    for f in JSON_DIR.glob("*.json"):
        f.unlink()

    # ── Phase 1: Normalize ─────────────────────────────────────────────────
    pages: list[dict] = []
    slugs_seen: set[str] = set()

    for soc_code in LAUNCH_SOCS:
        if soc_code not in wage_matrix:
            print(f"  SKIP: {soc_code} not in wage_matrix")
            continue
        soc_label = soc_lookup.get(soc_code, soc_code)

        for area_code in LAUNCH_AREAS:
            if area_code not in wage_matrix[soc_code]:
                continue
            area_label = area_lookup.get(area_code, area_code)
            raw_t = wage_matrix[soc_code][area_code]

            if (
                len(raw_t) != 4
                or not all(isinstance(v, (int, float)) for v in raw_t)
                or not all(v > 0 for v in raw_t)
                or not (raw_t[0] <= raw_t[1] <= raw_t[2] <= raw_t[3])
            ):
                print(f"  SKIP bad data: {soc_code}/{area_code}")
                continue

            slug = make_page_slug(soc_label, area_label)
            if slug in slugs_seen:
                slug = f"{slug}-{soc_code.replace('.', '-')}"
            assert slug not in slugs_seen, f"Slug collision: {slug}"
            slugs_seen.add(slug)

            short = area_short_name(area_label)
            t = [int(v) for v in raw_t]

            pages.append({
                "__schema_version": "1.0.0",
                "identity": {
                    "slug": slug,
                    "soc_code": soc_code,
                    "soc_label": soc_label,
                    "area_code": area_code,
                    "area_label": area_label,
                    "area_short": short,
                    "canonical_url": f"{CANONICAL_HOST}/{slug}",
                },
                "seo": {
                    "title": f"H-1B Wage Level: {soc_label} in {short} ({FY_LABEL})",
                    "description": (
                        f"OEWS Level I\u2013IV wage thresholds for {soc_label} "
                        f"(SOC {soc_code}) in {area_label}. DHS weighted "
                        f"selection probabilities under the {FY_LABEL} final rule."
                    ),
                    "keywords": (
                        f"h1b wage level {soc_label.lower()} {short.lower()}, "
                        f"h1b lottery odds {short.lower()}, "
                        f"{soc_code} wage level {area_code}"
                    ),
                },
                "thresholds": {
                    "level_1": t[0], "level_2": t[1],
                    "level_3": t[2], "level_4": t[3],
                },
                "selection": {
                    "fy_label": FY_LABEL,
                    "baselines": DHS_BASELINES,
                    "reg_open": REG_OPEN,
                    "reg_close": REG_CLOSE,
                },
                "metadata": {
                    "source": raw["metadata"]["source"],
                    "geo_delineation": raw["metadata"]["geo_delineation"],
                    "last_updated": TODAY,
                    "data_vintage": "2025-26",
                },
                "related": {
                    "same_soc_other_areas": [],
                    "same_area_other_socs": [],
                },
                "faq": generate_faq(soc_label, short, t),
            })

    print(f"Phase 1: {len(pages)} pages normalized")

    # ── Phase 2: Enrich — resolve related pages ────────────────────────────
    by_soc: dict[str, list[dict]] = {}
    by_area: dict[str, list[dict]] = {}
    for p in pages:
        by_soc.setdefault(p["identity"]["soc_code"], []).append(p)
        by_area.setdefault(p["identity"]["area_code"], []).append(p)

    for p in pages:
        soc = p["identity"]["soc_code"]
        area = p["identity"]["area_code"]

        same_soc = sorted(
            [x for x in by_soc.get(soc, []) if x["identity"]["area_code"] != area],
            key=lambda x: x["thresholds"]["level_1"], reverse=True,
        )[:5]
        p["related"]["same_soc_other_areas"] = [
            {"slug": x["identity"]["slug"],
             "area_label": x["identity"]["area_short"],
             "l1": x["thresholds"]["level_1"]}
            for x in same_soc
        ]

        same_area = sorted(
            [x for x in by_area.get(area, []) if x["identity"]["soc_code"] != soc],
            key=lambda x: x["thresholds"]["level_1"], reverse=True,
        )[:5]
        p["related"]["same_area_other_socs"] = [
            {"slug": x["identity"]["slug"],
             "soc_label": x["identity"]["soc_label"],
             "l1": x["thresholds"]["level_1"]}
            for x in same_area
        ]

    print("Phase 2: related pages enriched")

    # ── Write per-page JSON ────────────────────────────────────────────────
    for p in pages:
        path = JSON_DIR / f"{p['identity']['slug']}.json"
        path.write_text(json.dumps(p, indent=2, ensure_ascii=False), encoding="utf-8")

    # ── Write manifest ─────────────────────────────────────────────────────
    manifest = {
        "build_timestamp": datetime.now(timezone.utc).isoformat(),
        "canonical_host": CANONICAL_HOST,
        "page_count": len(pages),
        "soc_index": sorted(set(
            (p["identity"]["soc_code"], p["identity"]["soc_label"])
            for p in pages
        )),
        "area_index": sorted(set(
            (p["identity"]["area_code"], p["identity"]["area_short"])
            for p in pages
        )),
        "pages": [
            {
                "slug": p["identity"]["slug"],
                "soc_code": p["identity"]["soc_code"],
                "soc_label": p["identity"]["soc_label"],
                "area_code": p["identity"]["area_code"],
                "area_label": p["identity"]["area_label"],
                "area_short": p["identity"]["area_short"],
                "l1": p["thresholds"]["level_1"],
                "l4": p["thresholds"]["level_4"],
                "canonical_url": p["identity"]["canonical_url"],
            }
            for p in pages
        ],
    }
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"Wrote {len(pages)} JSON files → {JSON_DIR}")
    print(f"Wrote manifest → {MANIFEST_PATH}")
    print(f"Unique slugs: {len(slugs_seen)}")


if __name__ == "__main__":
    main()

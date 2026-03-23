#!/usr/bin/env python3
"""
build.py — Static site builder for wagelevel.fyi.

Reads per-page JSON objects from database/json/, renders Jinja2 templates,
and writes flat HTML + sitemap + robots to dist/.
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

ROOT = Path(__file__).resolve().parent
JSON_DIR = ROOT / "database" / "json"
MANIFEST_PATH = ROOT / "database" / "manifest.json"
TEMPLATES_DIR = ROOT / "src" / "templates"
DIST_DIR = ROOT / "dist"
CANONICAL_HOST = "https://www.wagelevel.fyi"
TODAY = datetime.now().strftime("%Y-%m-%d")


# ─── Custom Jinja2 Filters ────────────────────────────────────────────────────

def filter_currency(value: int | float) -> str:
    return f"${int(value):,}"


def filter_comma(value: int | float) -> str:
    return f"{int(value):,}"


# ─── Build Steps ──────────────────────────────────────────────────────────────

def clean_dist() -> None:
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)


def build_pages(env: Environment) -> int:
    template = env.get_template("page.html")
    count = 0
    for json_file in sorted(JSON_DIR.glob("*.json")):
        data = json.loads(json_file.read_text(encoding="utf-8"))
        html = template.render(**data, site_domain=CANONICAL_HOST)
        out = DIST_DIR / f"{data['identity']['slug']}.html"
        out.write_text(html, encoding="utf-8")
        count += 1
    return count


def build_hub_wage_data(manifest: dict) -> dict:
    """Build compact wage data structure for the hub calculator JS."""
    raw_data = json.loads((ROOT / "data" / "wage_data.json").read_text(encoding="utf-8"))
    wage_matrix = raw_data["wage_matrix"]

    # Build SOC list (ordered)
    socs = [[code, label] for code, label in manifest["soc_index"]]

    # Build per-SOC area lists and matrix
    areas_by_soc: dict[str, list] = {}
    matrix: dict[str, dict] = {}

    # Create a slug lookup from manifest pages
    slug_lookup: dict[tuple[str, str], str] = {}
    for page in manifest["pages"]:
        slug_lookup[(page["soc_code"], page["area_code"])] = page["slug"]

    for soc_code, _ in manifest["soc_index"]:
        soc_areas = []
        soc_matrix: dict[str, dict] = {}
        for page in manifest["pages"]:
            if page["soc_code"] == soc_code:
                area_code = page["area_code"]
                soc_areas.append([area_code, page["area_short"]])
                t = wage_matrix.get(soc_code, {}).get(area_code)
                if t:
                    soc_matrix[area_code] = {
                        "t": [int(v) for v in t],
                        "s": page["slug"],
                    }
        areas_by_soc[soc_code] = soc_areas
        if soc_code not in matrix:
            matrix[soc_code] = {}
        matrix[soc_code].update(soc_matrix)

    return {"socs": socs, "areas_by_soc": areas_by_soc, "matrix": matrix}


def build_index(env: Environment, manifest: dict) -> None:
    template = env.get_template("index.html")
    hub_data = build_hub_wage_data(manifest)
    html = template.render(
        manifest=manifest,
        site_domain=CANONICAL_HOST,
        today=TODAY,
        hub_wage_data=hub_data,
    )
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")


def write_sitemap(manifest: dict) -> None:
    urls = [
        f'  <url><loc>{CANONICAL_HOST}/</loc><lastmod>{TODAY}</lastmod>'
        f"<priority>1.0</priority></url>"
    ]
    for page in manifest["pages"]:
        urls.append(
            f'  <url><loc>{page["canonical_url"]}</loc><lastmod>{TODAY}</lastmod>'
            f"<priority>0.8</priority></url>"
        )
    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )
    (DIST_DIR / "sitemap.xml").write_text(sitemap, encoding="utf-8")


def write_robots() -> None:
    robots = f"User-agent: *\nAllow: /\n\nSitemap: {CANONICAL_HOST}/sitemap.xml\n"
    (DIST_DIR / "robots.txt").write_text(robots, encoding="utf-8")


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        undefined=StrictUndefined,
        autoescape=False,
    )
    env.filters["currency"] = filter_currency
    env.filters["comma"] = filter_comma

    clean_dist()
    page_count = build_pages(env)
    build_index(env, manifest)
    write_sitemap(manifest)
    write_robots()

    print(f"Built {page_count} pages + index + sitemap + robots → {DIST_DIR}")


if __name__ == "__main__":
    main()

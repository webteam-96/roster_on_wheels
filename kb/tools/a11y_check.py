"""Accessibility check (WCAG 2.1 AA, build spec 5) of the public club and district websites with axe-core.

    python -I kb/tools/a11y_check.py <out.json> <url> [<url> ...]
e.g. python -I kb/tools/a11y_check.py a11y.json http://a11y.localhost:3001/ http://a11y.localhost:3001/about
Each page is opened in Chromium (Playwright), axe-core (row/club-website/node_modules/axe-core) runs with the
wcag2a, wcag2aa, wcag21a and wcag21aa tags, and every violation is listed with its impact and how many elements fail.
Exit code 1 when any serious or critical violation is found.
"""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

AXE = pathlib.Path(__file__).resolve().parents[2] / "row" / "club-website" / "node_modules" / "axe-core" / "axe.min.js"
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
out, urls = sys.argv[1], sys.argv[2:]
results, worst = [], 0
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    for url in urls:
        page.goto(url, wait_until="networkidle", timeout=120_000)
        page.add_script_tag(path=str(AXE))
        r = page.evaluate("tags => axe.run(document, { runOnly: { type: 'tag', values: tags } })", TAGS)
        v = [{"id": x["id"], "impact": x["impact"], "help": x["help"], "nodes": len(x["nodes"]),
              "example": x["nodes"][0]["target"] if x["nodes"] else None} for x in r["violations"]]
        results.append({"url": url, "violations": v})
        bad = [x for x in v if x["impact"] in ("serious", "critical")]
        worst += len(bad)
        print(f"{url}: {len(v)} rules fail ({len(bad)} serious/critical)")
        for x in sorted(v, key=lambda x: ["critical", "serious", "moderate", "minor"].index(x["impact"] or "minor")):
            print(f"   {x['impact']:9} {x['id']:28} x{x['nodes']:<3} {x['help'][:70]}")
    browser.close()
pathlib.Path(out).write_text(json.dumps(results, indent=1), encoding="utf-8")
sys.exit(1 if worst else 0)

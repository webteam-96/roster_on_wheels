"""District website public API (api/public/district/..., 2026-10-21).

    python kb/tools/district_site_e2e.py [api_base] [mysql_port]
Dev database only, no login needed. Uses the first district; gives it a district_websites row for the run if it has
none and removes it again. Checks the pages' data, that no private field leaks, that admin HTML is sanitized, and
that every route goes dark when the website is switched off.
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
PORT = sys.argv[2] if len(sys.argv) > 2 else "3317"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0
PRIVATE = {"mobile", "mobileNumber", "primaryMobileNumber", "emailId", "memberId", "spouseName", "bloodGroup"}


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", "row_local", "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def get(path):
    try:
        with urllib.request.urlopen(API + path, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def keys(o):
    if isinstance(o, dict):
        return set(o) | set().union(*(keys(v) for v in o.values()))
    if isinstance(o, list):
        return set().union(*(keys(v) for v in o)) if o else set()
    return set()


d = int(sql("SELECT pk_district_id FROM district_master WHERE isdeleted=0 ORDER BY 1 LIMIT 1"))
had_site = sql(f"SELECT COUNT(*) FROM district_websites WHERE fk_district_id={d} AND isdeleted=0") != "0"
if not had_site:
    sql(f"INSERT INTO district_websites (fk_district_id, Subdomain, Status) VALUES ({d}, 'e2e-district-{d}', 'Active')")
sub = sql(f"SELECT Subdomain FROM district_websites WHERE fk_district_id={d} AND isdeleted=0 LIMIT 1")
about_id = None
B = f"/api/public/district/{d}"
try:
    s, b = get(f"/api/public/district/by-host?host={sub}.localhost")
    check("by-host finds the district", s == 200 and b and b.get("districtId") == d, (s, b))
    s, b = get("/api/public/district/by-host?host=nobody-here.localhost")
    check("an unknown host is 404", s == 404, s)

    for path in ["/site", "/banners", "/advertisements", "/about", "/dignitaries", "/events?year=2026&month=10",
                 "/newsletters?variant=governor", "/newsletters?variant=club", "/committee", "/clubs", "/snapshot",
                 "/projects?pageSize=5", "/menus"]:
        s, b = get(B + path)
        leaked = keys(b) & PRIVATE
        check(f"{path} answers with public fields only", s == 200 and not leaked, (s, leaked))

    s, _ = get(B + "/events?year=2026&month=13")
    check("a bad month is refused", s == 400, s)
    s, _ = get(B + "/newsletters?variant=secret")
    check("an unknown newsletter variant is refused", s == 400, s)
    s, _ = get(B + "/projects?avenue=nope")
    check("an unknown avenue is refused", s == 400, s)
    s, b = get(B + "/projects?pageSize=500")
    check("project pages are capped", s == 200 and len(b) <= 60, (s, len(b or [])))

    other_club = sql(f"SELECT COALESCE(MIN(pk_club_id), 0) FROM club_master WHERE fk_district_id <> {d}")
    if other_club != "0":
        s, _ = get(f"{B}/clubs/{other_club}/projects/1")
        check("a club of another district is not served", s == 404, s)

    sql(f"INSERT INTO club_website_about (fk_club_id, fk_district_id, content, is_active) VALUES "
        f"(0, {d}, '<p>Hello</p><script>alert(1)</script><img src=x onerror=alert(2)>', 1)")
    about_id = sql("SELECT LAST_INSERT_ID()")
    s, b = get(B + "/about")
    html = (b or {}).get("content") or ""
    check("admin HTML is sanitized", s == 200 and "Hello" in html and "<script" not in html and "onerror" not in html, html)

    sql(f"UPDATE district_websites SET isdeleted=1 WHERE fk_district_id={d}")
    s, _ = get(B + "/site")
    s2, _ = get(B + "/projects")
    check("a switched-off district website goes dark", s == 404 and s2 == 404, (s, s2))
finally:
    sql(f"UPDATE district_websites SET isdeleted=0 WHERE fk_district_id={d} AND Subdomain='{sub}'")
    if about_id:
        sql(f"DELETE FROM club_website_about WHERE pk_club_website_about_id={about_id}")
    if not had_site:
        sql(f"DELETE FROM district_websites WHERE fk_district_id={d} AND Subdomain='e2e-district-{d}'")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

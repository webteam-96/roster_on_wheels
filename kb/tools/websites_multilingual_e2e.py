"""Multilingual club and district websites (build spec 3.11, flag website_languages).

    python -I kb/tools/websites_multilingual_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Writes test rows to the given
local database (a district and a club website row when missing, three menus, a sub-menu, the translations) and removes
them again; switches the flag through the API and puts it back. Audit rows stay (audit_log is append-only).
Local copies only, never production.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
FLAG = "website_languages"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def insert(q):
    return int(sql(q + "; SELECT LAST_INSERT_ID();").splitlines()[-1])


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"} if data else {}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw) if raw else None
        except ValueError:
            return e.code, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def item(items, kind, item_id=0):
    return next((i for i in items or [] if i["type"] == kind and i["id"] == item_id), None)


ACTIVE = ("c.isdeleted=0 AND c.IsActive=1 AND d.isdeleted=0 AND d.IsActive=1 AND z.isdeleted=0 AND z.IsActive=1")
JOINS = "club_master c JOIN district_master d ON d.pk_district_id=c.fk_district_id JOIN zone_master z ON z.pk_zone_id=d.fk_zone_id"

# A club with an active club admin (district D is its district), a club in another district, a plain member of the
# first club and the SuperAdmin. Picked by query, never hard-coded.
club, district = [int(x) for x in sql(
    f"SELECT c.pk_club_id, c.fk_district_id FROM {JOINS} JOIN member_roles r ON r.fk_club_id=c.pk_club_id "
    f"AND r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0 WHERE {ACTIVE} ORDER BY 1 LIMIT 1").split()]
other_club, other_district = [int(x) for x in sql(
    f"SELECT c.pk_club_id, c.fk_district_id FROM {JOINS} WHERE {ACTIVE} AND c.fk_district_id<>{district} "
    f"AND NOT EXISTS (SELECT 1 FROM district_websites w WHERE w.fk_district_id=c.fk_district_id AND w.isdeleted=0) "
    "ORDER BY 1 LIMIT 1").split()]
admin = int(sql(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id={club} AND fk_role_id=2 "
                "AND IsActive=1 AND isdeleted=0 LIMIT 1"))
plain = int(sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND cm.IsActive=1 "
                "AND IFNULL(cm.isdeleted,0)=0 AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id "
                "FROM member_roles WHERE fk_role_id<>1 AND IsActive=1) LIMIT 1"))
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
t_sa, t_admin, t_plain = token(sa, "SuperAdmin"), token(admin, "Admin"), token(plain, "Member")
was_on = sql(f"SELECT COUNT(*) FROM platform_features WHERE feature_key='{FLAG}' AND enabled=1") == "1"
had_row = sql(f"SELECT COUNT(*) FROM platform_features WHERE feature_key='{FLAG}'") == "1"
brand_default = call("GET", "/api/public/brand")[1]["locale"]["defaultLanguage"]

cleanup = []
D, C = f"/api/districts/{district}/website-languages", f"/api/clubs/{club}/website-languages"
PUB_D, PUB_C = f"/api/public/website-languages/district/{district}", f"/api/public/website-languages/club/{club}"
try:
    # Live websites for the district and the club, three custom pages (two here, one in another district) and a sub-menu.
    if sql(f"SELECT COUNT(*) FROM district_websites WHERE fk_district_id={district} AND isdeleted=0") == "0":
        w = insert(f"INSERT INTO district_websites (fk_district_id, Subdomain, Status) VALUES ({district}, 'e2e-ml-d{district}', 'Active')")
        cleanup.append(f"DELETE FROM district_websites WHERE pk_id={w}")
    if sql(f"SELECT COUNT(*) FROM club_websites WHERE fk_club_id={club} AND isdeleted=0") == "0":
        w = insert(f"INSERT INTO club_websites (fk_club_id, Subdomain, StartDate, EndDate) "
                   f"VALUES ({club}, 'e2e-ml-c{club}', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY))")
        cleanup.append(f"DELETE FROM club_websites WHERE pk_id={w}")

    def menu(club_id, district_id, name):
        m = insert("INSERT INTO club_website_menu (fk_club_id, fk_district_id, menu_name, link_type, link_value, content_html, sort_order) "
                   f"VALUES ({club_id}, {district_id}, '{name}', 'html', 'e2e-page', '<p>Hello world</p>', 99)")
        cleanup.insert(0, f"DELETE FROM club_website_menu WHERE pk_club_website_menu_id={m}")
        return m

    page = menu(0, district, "E2E Page")
    foreign_page = menu(0, other_district, "E2E Foreign")
    club_page = menu(club, "NULL", "E2E Club Page")
    sub = insert(f"INSERT INTO club_website_submenu (fk_menu_id, submenu_name, link_type, link_value) VALUES ({page}, 'E2E Sub', 'page', 'e2e-sub')")
    cleanup.insert(0, f"DELETE FROM club_website_submenu WHERE pk_club_website_submenu_id={sub}")
    cleanup.append(f"DELETE FROM website_translations WHERE (scope='district' AND owner_id={district}) OR (scope='club' AND owner_id={club})")
    cleanup.append(f"DELETE FROM website_languages WHERE (scope='district' AND owner_id={district}) OR (scope='club' AND owner_id={club})")

    # Off: every route answers 404, so the public sites show their default language only.
    call("PUT", f"/api/features/{FLAG}", t_sa, {"enabled": False})
    check("flag off: editor 404", call("GET", D, t_sa)[0] == 404, call("GET", D, t_sa))
    check("flag off: public 404", call("GET", PUB_D)[0] == 404, call("GET", PUB_D))
    s, _ = call("PUT", f"/api/features/{FLAG}", t_sa, {"enabled": True})
    check("SuperAdmin switches the flag on", s in (200, 204), s)

    s, body = call("GET", D, t_sa)
    check("new site: brand default only", s == 200 and body == {"defaultLanguage": brand_default, "languages": [brand_default]}, body)

    # Languages: managers only, validated on the server.
    s, body = call("PUT", D, t_sa, {"defaultLanguage": "en", "languages": ["fr", "EN"]})
    check("district languages saved, default first", s == 200 and body["languages"] == ["en", "fr"], (s, body))
    s, _ = call("PUT", D, t_sa, {"defaultLanguage": "en", "languages": ["fr", "x<y"]})
    check("bad language code refused", s == 400, s)
    s, _ = call("PUT", D, t_sa, {"defaultLanguage": "en", "languages": [f"l{chr(97 + i)}" for i in range(11)]})
    check("more than 10 languages refused", s == 400, s)
    check("club admin cannot change a district's languages", call("PUT", D, t_admin, {"defaultLanguage": "en", "languages": ["de"]})[0] == 403)
    check("plain member cannot change the languages", call("PUT", D, t_plain, {"defaultLanguage": "en", "languages": ["de"]})[0] == 403)
    check("outsider cannot read another district's drafts",
          call("GET", f"/api/districts/{other_district}/website-languages/en", t_admin)[0] == 403)

    # Translations.
    s, _ = call("PUT", f"{D}/fr/about/0", t_sa, {"title": "A propos du district", "body": "<p>Bonjour</p><script>alert(1)</script>",
                                                "seoTitle": "District FR", "seoDescription": "Description FR"})
    check("about saved in French", s == 204, s)
    check("page saved in French", call("PUT", f"{D}/fr/page/{page}", t_sa, {"title": "Page E2E FR", "body": "<p>Bonjour le monde</p>"})[0] == 204)
    check("menu label saved in French", call("PUT", f"{D}/fr/submenu/{sub}", t_sa, {"title": "Sous E2E"})[0] == 204)
    check("another district's page refused", call("PUT", f"{D}/fr/page/{foreign_page}", t_sa, {"title": "x"})[0] == 400)
    check("a club's page refused on the district", call("PUT", f"{D}/fr/page/{club_page}", t_sa, {"title": "x"})[0] == 400)
    check("language not on the site refused", call("PUT", f"{D}/de/about/0", t_sa, {"title": "x"})[0] == 400)
    check("unknown item type refused", call("PUT", f"{D}/fr/stories/0", t_sa, {"title": "x"})[0] == 400)
    check("club admin cannot write the district's texts", call("PUT", f"{D}/fr/about/0", t_admin, {"title": "x"})[0] == 403)
    check("default language SEO saved", call("PUT", f"{D}/en/site/0", t_sa, {"seoTitle": "District EN SEO", "title": "ignored"})[0] == 204)

    s, items = call("GET", f"{D}/fr", t_sa)
    p = item(items, "page", page)
    check("editor lists the page with its source and translation",
          s == 200 and p and p["sourceBody"] == "<p>Hello world</p>" and p["title"] == "Page E2E FR" and p["hasBody"], p)
    check("editor shows the default SEO next to the French", item(items, "site")["sourceSeoTitle"] == "District EN SEO", item(items, "site"))
    check("editor refuses a language not on the site", call("GET", f"{D}/de", t_sa)[0] == 400)

    # The public site: French when asked, the default otherwise; HTML sanitised.
    s, fr = call("GET", f"{PUB_D}?lang=fr")
    about = item(fr["items"] if fr else [], "about")
    check("public French: language and list", s == 200 and fr["language"] == "fr" and fr["languages"] == ["en", "fr"], fr)
    check("public French: About in French", about and about["title"] == "A propos du district" and "Bonjour" in about["body"], about)
    check("public French: script stripped", about and "<script" not in about["body"], about)
    check("public French: page and menu label", item(fr["items"], "page", page)["title"] == "Page E2E FR"
          and item(fr["items"], "submenu", sub)["title"] == "Sous E2E", fr["items"])
    check("public: language match ignores case", call("GET", f"{PUB_D}?lang=FR")[1]["language"] == "fr")
    s, en = call("GET", PUB_D)
    check("public default: English with its SEO, no French text",
          s == 200 and en["language"] == "en" and item(en["items"], "site")["seoTitle"] == "District EN SEO"
          and item(en["items"], "site")["title"] is None and item(en["items"], "about") is None, en)
    check("public: a language the site lacks shows the default", call("GET", f"{PUB_D}?lang=de")[1]["language"] == "en")
    check("public: a district without a website is 404",
          call("GET", f"/api/public/website-languages/district/{other_district}")[0] == 404)

    # Removing.
    check("translation removed", call("DELETE", f"{D}/fr/submenu/{sub}", t_sa)[0] == 204)
    check("removing it again is 404", call("DELETE", f"{D}/fr/submenu/{sub}", t_sa)[0] == 404)
    call("PUT", f"{D}/fr/page/{page}", t_sa, {"title": " ", "body": ""})
    check("saving all fields empty removes the row", item(call("GET", f"{PUB_D}?lang=fr")[1]["items"], "page", page) is None)

    # Club scope: the club's own admin, not another club's.
    s, body = call("PUT", C, t_admin, {"defaultLanguage": "en", "languages": ["en", "es"]})
    check("club admin sets the club's languages", s == 200 and body["languages"] == ["en", "es"], (s, body))
    check("club admin cannot set another club's languages",
          call("PUT", f"/api/clubs/{other_club}/website-languages", t_admin, {"defaultLanguage": "en", "languages": ["es"]})[0] == 403)
    check("club page saved in Spanish", call("PUT", f"{C}/es/page/{club_page}", t_admin, {"title": "Pagina E2E"})[0] == 204)
    check("district page refused on the club", call("PUT", f"{C}/es/page/{page}", t_admin, {"title": "x"})[0] == 400)
    s, es = call("GET", f"{PUB_C}?lang=es")
    check("public club site in Spanish", s == 200 and item(es["items"], "page", club_page)["title"] == "Pagina E2E", es)

    check("writes are in the audit log", int(sql(
        f"SELECT COUNT(*) FROM audit_log WHERE details LIKE 'PUT /api/districts/{district}/website-languages%'")) > 0)
finally:
    for q in cleanup:
        sql(q)
    call("PUT", f"/api/features/{FLAG}", t_sa, {"enabled": was_on})
    if not had_row:
        sql(f"DELETE FROM platform_features WHERE feature_key='{FLAG}'")  # no row and a 0 row both mean off
    left = sql(f"SELECT COUNT(*) FROM website_translations WHERE (scope='district' AND owner_id={district}) OR (scope='club' AND owner_id={club})")
    check("test rows removed", left == "0", left)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

"""Website extras: social feed embeds, Google Analytics ID, site search, sitemap entries and page QR codes.

    python -I kb/tools/website_extras_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Writes test rows to the given
local database (a club website row when missing, a published and an unpublished event, the extras rows)
and removes them again. Audit rows stay (audit_log is append-only). Sends no email. Local copies only, never production.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
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


def call(method, path, tok=None, body=None, raw=False):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Content-Type": "application/json"} if data else {}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            content = r.read()
            if raw:
                return r.status, (r.headers.get("Content-Type"), content)
            return r.status, json.loads(content) if content else None
    except urllib.error.HTTPError as e:
        content = e.read()
        try:
            return e.code, json.loads(content) if content else None
        except ValueError:
            return e.code, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


ACTIVE = "c.isdeleted=0 AND c.IsActive=1 AND d.isdeleted=0 AND d.IsActive=1 AND z.isdeleted=0 AND z.IsActive=1"
JOINS = "club_master c JOIN district_master d ON d.pk_district_id=c.fk_district_id JOIN zone_master z ON z.pk_zone_id=d.fk_zone_id"

# A club with an active club admin, an admin of a club in another district, a plain member, the SuperAdmin.
club, district = [int(x) for x in sql(
    f"SELECT c.pk_club_id, c.fk_district_id FROM {JOINS} JOIN member_roles r ON r.fk_club_id=c.pk_club_id "
    f"AND r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0 WHERE {ACTIVE} ORDER BY 1 LIMIT 1").split()]
admin = int(sql(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id={club} AND fk_role_id=2 "
                "AND IsActive=1 AND isdeleted=0 LIMIT 1"))
other_club = int(sql(f"SELECT c.pk_club_id FROM {JOINS} JOIN member_roles r ON r.fk_club_id=c.pk_club_id AND r.fk_role_id=2 "
                     f"AND r.IsActive=1 AND r.isdeleted=0 WHERE {ACTIVE} AND c.fk_district_id<>{district} ORDER BY 1 LIMIT 1"))
outsider = int(sql(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id={other_club} AND fk_role_id=2 "
                   "AND IsActive=1 AND isdeleted=0 LIMIT 1"))
plain = int(sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND cm.IsActive=1 "
                "AND IFNULL(cm.isdeleted,0)=0 AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id "
                "FROM member_roles WHERE fk_role_id<>1 AND IsActive=1) LIMIT 1"))
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
t_sa, t_admin, t_plain, t_out = token(sa, "SuperAdmin"), token(admin, "Admin"), token(plain, "Member"), token(outsider, "Admin")
no_site_club = int(sql(f"SELECT c.pk_club_id FROM {JOINS} WHERE {ACTIVE} AND NOT EXISTS (SELECT 1 FROM club_websites w "
                       "WHERE w.fk_club_id=c.pk_club_id) ORDER BY 1 LIMIT 1"))

C, D = f"/api/clubs/{club}/website-extras", f"/api/districts/{district}/website-extras"
PUB = f"/api/public/website-extras/club/{club}"
had_extras = sql(f"SELECT COUNT(*) FROM website_extras WHERE (scope='club' AND owner_id={club}) OR (scope='district' AND owner_id={district})")
cleanup = []
try:
    if had_extras != "0":
        raise SystemExit("website_extras rows already exist for the test club/district; refusing to overwrite them")
    cleanup.append(f"DELETE FROM website_extras WHERE (scope='club' AND owner_id={club}) OR (scope='district' AND owner_id={district})")
    if sql(f"SELECT COUNT(*) FROM club_websites WHERE fk_club_id={club} AND isdeleted=0") == "0":
        w = insert(f"INSERT INTO club_websites (fk_club_id, Subdomain, StartDate, EndDate) "
                   f"VALUES ({club}, 'e2e-x-c{club}', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY))")
        cleanup.append(f"DELETE FROM club_websites WHERE pk_id={w}")
    # The site's host, as the club site's web.config passes it: the first label of the stored Subdomain.
    sub = sql(f"SELECT Subdomain FROM club_websites WHERE fk_club_id={club} AND isdeleted=0 ORDER BY created_date DESC LIMIT 1")
    label = sub.lower().split("//")[-1].split("/")[0].split(".")[0]
    HOST = f"{label}.localhost"
    ev = insert("INSERT INTO upcoming_events (fk_club_id, Title, Description, EventVenue, EventDate, PublishDate, ExpiryDate) "
                f"VALUES ({club}, 'E2E qzebra fun run', '<p>Run for <b>polio</b> qzebra</p>', 'Park', DATE_ADD(CURDATE(), INTERVAL 5 DAY), "
                "DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 10 DAY))")
    cleanup.insert(0, f"DELETE FROM upcoming_events WHERE pk_upcoming_event_id={ev}")
    draft = insert("INSERT INTO upcoming_events (fk_club_id, Title, Description, EventVenue, EventDate, PublishDate, ExpiryDate) "
                   f"VALUES ({club}, 'E2E qzebra draft', 'Not yet', 'Park', DATE_ADD(CURDATE(), INTERVAL 5 DAY), "
                   "DATE_ADD(NOW(), INTERVAL 3 DAY), DATE_ADD(NOW(), INTERVAL 10 DAY))")
    cleanup.insert(0, f"DELETE FROM upcoming_events WHERE pk_upcoming_event_id={draft}")

    # Admin settings.
    s, body = call("GET", C, t_admin)
    check("club admin reads empty extras + pages", s == 200 and body["settings"]["facebookPageUrl"] is None
          and {"/", "/events", "/social", "/search"} <= {p["path"] for p in body["pages"]}, (s, body))
    check("site address resolved", s == 200 and body["siteUrl"] and body["siteUrl"].startswith("http"), body)
    s, body = call("PUT", C, t_admin, {"facebookPageUrl": "https://evil.com/x"})
    check("bad Facebook link refused", s == 400 and "Facebook" in body["message"], (s, body))
    s, body = call("PUT", C, t_admin, {"gaMeasurementId": "<script>"})
    check("bad analytics id refused", s == 400, (s, body))
    s, body = call("PUT", C, t_admin, {"facebookPageUrl": "facebook.com/rotary", "instagramUsername": "@rotaryintl",
                                       "xUsername": "https://x.com/rotary", "gaMeasurementId": "g-e2e1234"})
    st = (body or {}).get("settings", {})
    check("valid settings saved normalized", s == 200 and st == {"facebookPageUrl": "https://www.facebook.com/rotary",
          "instagramUsername": "rotaryintl", "xUsername": "rotary", "gaMeasurementId": "G-E2E1234"}, (s, body))
    check("plain member can read (app share screen)", call("GET", C, t_plain)[0] == 200)
    check("plain member cannot save", call("PUT", C, t_plain, {"xUsername": "hacker"})[0] == 403)
    check("other club's admin cannot read", call("GET", C, t_out)[0] == 403)
    check("other club's admin cannot save", call("PUT", C, t_out, {"xUsername": "hacker"})[0] == 403)
    check("anonymous cannot read", call("GET", C)[0] == 401)
    other_district = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={other_club}"))
    check("club admin cannot save another district's extras",
          call("PUT", f"/api/districts/{other_district}/website-extras", t_admin, {"xUsername": "x"})[0] == 403)
    s, body = call("PUT", D, t_sa, {"xUsername": "district_x"})
    check("SuperAdmin saves district extras", s == 200 and body["settings"]["xUsername"] == "district_x", (s, body))

    # Public.
    s, body = call("GET", PUB)
    check("public extras of a live site", s == 200 and body["gaMeasurementId"] == "G-E2E1234", (s, body))
    check("public extras 404 without a site", call("GET", f"/api/public/website-extras/club/{no_site_club}")[0] == 404)
    s, hits = call("GET", f"{PUB}/search?q=qzebra")
    kinds = {(h["kind"], h["path"]) for h in hits or []}
    check("search finds the published event", ("event", f"/event?id={ev}") in kinds, hits)
    check("search hides the unpublished event", ("event", f"/event?id={draft}") not in kinds, hits)
    check("search snippet is plain text", all("<" not in (h["snippet"] or "") for h in hits or []), hits)
    s, hits = call("GET", f"{PUB}/search?q=a")
    check("one-letter search returns nothing", s == 200 and hits == [], (s, hits))
    s, hits = call("GET", f"{PUB}/search?q=" + urllib.parse.quote("q%zebra"))
    check("wildcards are literal", s == 200 and not any("qzebra" in h["title"].lower() for h in hits), hits)
    s, hits = call("GET", f"{PUB}/search?q=events")
    check("search finds fixed pages", s == 200 and any(h["path"] == "/events" for h in hits), hits)
    s, entries = call("GET", f"{PUB}/sitemap")
    paths = {e["path"] for e in entries or []}
    check("sitemap lists pages and the event",
          s == 200 and {"/", "/about", "/social", f"/event?id={ev}"} <= paths, (s, sorted(paths)[:20]))
    check("sitemap leaves out the draft and /search", f"/event?id={draft}" not in paths and "/search" not in paths)
    check("sitemap 404 without a site", call("GET", f"/api/public/website-extras/club/{no_site_club}/sitemap")[0] == 404)

    # What the club site's web.config redirects /sitemap.xml and /robots.txt to.
    s, res = call("GET", "/api/public/website-extras/sitemap-xml?host=" + urllib.parse.quote(HOST), raw=True)
    xml = res[1].decode() if s == 200 else ""
    check("sitemap.xml for the host", s == 200 and res[0].startswith("application/xml")
          and f"<loc>https://{HOST}/event?id={ev}</loc>" in xml and "<urlset" in xml, (s, xml[:300]))
    check("sitemap.xml 404 for an unknown host",
          call("GET", "/api/public/website-extras/sitemap-xml?host=no-such-club-e2e.example.org")[0] == 404)
    s, res = call("GET", "/api/public/website-extras/robots-txt?host=" + urllib.parse.quote(HOST), raw=True)
    txt = res[1].decode() if s == 200 else ""
    check("robots.txt of a live site names its sitemap", s == 200 and f"Sitemap: https://{HOST}/sitemap.xml" in txt
          and "Disallow: /search" in txt, (s, txt))
    s, res = call("GET", "/api/public/website-extras/robots-txt?host=no-such-club-e2e.example.org", raw=True)
    check("robots.txt closes an unknown host", s == 200 and "Disallow: /\n" in res[1].decode(), (s, res))

    # QR codes.
    s, res = call("GET", f"{C}/qr?path=" + urllib.parse.quote("/events"), t_admin, raw=True)
    check("QR PNG of a page", s == 200 and res[0] == "image/png" and res[1][:4] == b"\x89PNG", (s, res))
    s, res = call("GET", f"{C}/qr?format=svg&path=" + urllib.parse.quote(f"/event?id={ev}"), t_plain, raw=True)
    check("QR SVG for a member", s == 200 and res[0].startswith("image/svg") and b"<svg" in res[1], (s, res))
    check("QR refuses another host", call("GET", f"{C}/qr?path=" + urllib.parse.quote("//evil.com"), t_admin)[0] == 400)
    check("QR refused for an outsider", call("GET", f"{C}/qr?path=/", t_out)[0] == 403)
finally:
    for q in cleanup:
        try:
            sql(q)
        except subprocess.CalledProcessError as e:
            print("cleanup failed:", q, e.stderr)
    left = sql(f"SELECT COUNT(*) FROM upcoming_events WHERE Title LIKE 'E2E qzebra%'") + "/" + \
\
        sql(f"SELECT COUNT(*) FROM website_extras WHERE (scope='club' AND owner_id={club}) OR (scope='district' AND owner_id={district})")
    check("test rows removed", left == "0/0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

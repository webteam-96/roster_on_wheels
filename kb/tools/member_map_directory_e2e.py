"""Member map and business directory (competitor gap, 2026-11-19). A member opts in to the map (the point is stored
rounded to about 1 km), members of the club and district see the map with the clubs' meeting places, outsiders are
refused. A member lists a business; it shows in the district search and on the club website only after a club admin
approves it, an edit sends it back for approval, and the member can remove it.

    python -I kb/tools/member_map_directory_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Sends no email.
Writes rows for members 999 and 1068 of the LOCAL copy only and removes them at the end. Never run it against production.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, DISTRICT, MEMBER, ADMIN, OUTSIDER, OTHER_CLUB = 341, 5, 999, 1068, 2, 312  # 2: plain member of another district
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status, ctype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        payload, status, ctype = e.read(), e.code, e.headers.get("Content-Type", "")
    return status, (json.loads(payload) if "json" in ctype and payload else payload)


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))
    if not ok:
        fails += 1


def cleanup():
    sql(f"DELETE FROM member_map_pins WHERE fk_member_id IN ({MEMBER},{ADMIN});"
        f"DELETE FROM business_listings WHERE fk_member_id IN ({MEMBER},{ADMIN});")


member, admin, outsider = token(MEMBER, ["Member"]), token(ADMIN, ["Admin"]), token(OUTSIDER, ["Member"])
cleanup()
try:
    # ── map ──
    s, _ = call("GET", "/api/member-map/me")
    check("map: signed-out caller refused", s == 401, s)
    s, me = call("GET", "/api/member-map/me", member)
    check("map: member starts opted out and sees own clubs", s == 200 and me["showOnMap"] is False
          and any(c["clubId"] == CLUB for c in me["clubs"]), (s, me))
    s, _ = call("PUT", "/api/member-map/me", member, {"showOnMap": True, "city": "Colombo"})
    check("map: opt-in without a point refused", s == 400, s)
    s, _ = call("PUT", "/api/member-map/me", member, {"showOnMap": True, "latitude": 95, "longitude": 10})
    check("map: point off the globe refused", s == 400, s)
    s, me = call("PUT", "/api/member-map/me", member,
                 {"showOnMap": True, "city": "Colombo", "area": "Kollupitiya", "latitude": 6.9123456, "longitude": 79.8487654})
    stored = sql(f"SELECT CONCAT(latitude, ',', longitude) FROM member_map_pins WHERE fk_member_id = {MEMBER}")
    check("map: opt-in stores only the point rounded to 2 decimals", s == 200 and stored == "6.91,79.85", (s, stored))
    name = sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id = {MEMBER}")
    s, m = call("GET", f"/api/clubs/{CLUB}/member-map", member)
    mine = [x for x in (m.get("members", []) if s == 200 else []) if x["name"] == name]
    check("map: club member sees the club map with the rounded pin", s == 200 and mine
          and float(mine[0]["latitude"]) == 6.91 and mine[0]["area"] == "Kollupitiya", (s, m))
    check("map: no address or member id in the map payload", s == 200 and all(
        set(x) == {"name", "clubName", "city", "area", "latitude", "longitude"} for x in m["members"]), m.get("members", [])[:1])
    s, d = call("GET", f"/api/districts/{DISTRICT}/member-map", member)
    check("map: district map has the pin and meeting places", s == 200 and any(x["name"] == name for x in d["members"])
          and isinstance(d["meetingPlaces"], list), (s, str(d)[:200]))
    s1, _ = call("GET", f"/api/clubs/{CLUB}/member-map", outsider)
    s2, _ = call("GET", f"/api/districts/{DISTRICT}/member-map", outsider)
    check("map: member of another district refused (club and district)", s1 == 403 and s2 == 403, (s1, s2))
    s, me = call("PUT", "/api/member-map/me", member, {"showOnMap": False})
    left = sql(f"SELECT COUNT(*) FROM member_map_pins WHERE fk_member_id = {MEMBER}")
    check("map: opting out deletes the pin", s == 200 and me["showOnMap"] is False and left == "0", (s, left))

    # ── business directory ──
    listing = {"clubId": CLUB, "businessName": "E2E Tea Traders", "classification": "Tea export",
               "description": "Ceylon tea for the e2e run", "website": "https://e2e-tea.lk", "phone": "+94 11 234 5678"}
    s, _ = call("PUT", "/api/business-directory/me", member, {**listing, "clubId": OTHER_CLUB})
    check("directory: listing under someone else's club refused", s == 400, s)
    s, _ = call("PUT", "/api/business-directory/me", member, {**listing, "website": "javascript:alert(1)"})
    check("directory: bad website refused", s == 400, s)
    s, mine = call("PUT", "/api/business-directory/me", member, listing)
    lid = (mine.get("listing") or {}).get("id") if s == 200 else None
    check("directory: member's listing saved as pending", s == 200 and mine["listing"]["status"] == "pending", (s, mine))
    q = urllib.parse.quote("tea export")
    s, r = call("GET", f"/api/districts/{DISTRICT}/business-directory?q={q}", member)
    check("directory: pending listing not in the district search", s == 200 and all(x["id"] != lid for x in r), (s, r))
    s, r = call("GET", f"/api/public/club/{CLUB}/business-directory?q={q}")
    check("directory: pending listing not on the website", s == 200 and all(x["id"] != lid for x in r), (s, r))
    s, _ = call("POST", f"/api/business-directory/{lid}/review", member, {"approve": True})
    check("directory: ordinary member cannot approve", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{CLUB}/business-directory/review", member)
    check("directory: ordinary member cannot open the review list", s == 403, s)
    # Any club-only admin in the district (other test runs on this shared copy may give 1068 district rights).
    club_only = sql(f"""SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN club_master c ON c.pk_club_id = mr.fk_club_id
        WHERE mr.fk_role_id = 2 AND mr.IsActive = 1 AND mr.isdeleted = 0 AND c.fk_district_id = {DISTRICT}
          AND NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id = mr.fk_member_master_profile_id
              AND x.IsActive = 1 AND x.isdeleted = 0 AND (x.fk_role_id = 3 OR (x.fk_role_id = 2 AND IFNULL(x.fk_club_id, 0) = 0)))
        LIMIT 1""")
    s, _ = call("GET", f"/api/districts/{DISTRICT}/business-directory/review", token(int(club_only), ["Admin"]))
    check(f"directory: club-only admin ({club_only}) cannot open the district review list", s == 403, s)
    s, r = call("GET", f"/api/clubs/{CLUB}/business-directory/review?status=pending", admin)
    check("directory: club admin sees it in the pending list", s == 200 and any(x["id"] == lid for x in r), (s, r))
    s, _ = call("POST", f"/api/business-directory/{lid}/review", admin, {"approve": False})
    check("directory: rejecting needs a reason", s == 400, s)
    s, r = call("POST", f"/api/business-directory/{lid}/review", admin, {"approve": True})
    check("directory: club admin approves", s == 200 and r["status"] == "approved", (s, r))
    s, r = call("GET", f"/api/districts/{DISTRICT}/business-directory?q={q}", member)
    check("directory: approved listing found by classification", s == 200 and any(x["id"] == lid for x in r), (s, r))
    s, r = call("GET", f"/api/public/club/{CLUB}/business-directory?q=e2e%20tea")
    check("directory: approved listing on the club website", s == 200 and any(
        x["id"] == lid and x["website"] == "https://e2e-tea.lk" for x in r), (s, r))
    s, r = call("GET", f"/api/public/club/{CLUB}/business-directory?q=%25")
    check("directory: % in the search is literal", s == 200 and all(x["id"] != lid for x in r), (s, len(r)))
    s, _ = call("GET", f"/api/districts/{DISTRICT}/business-directory", outsider)
    check("directory: member of another district refused", s == 403, s)
    s, _ = call("GET", "/api/public/club/999999999/business-directory")
    check("directory: unknown club on the website is 404", s == 404, s)
    s, mine = call("PUT", "/api/business-directory/me", member, {**listing, "description": "Edited"})
    s2, r = call("GET", f"/api/districts/{DISTRICT}/business-directory?q={q}", member)
    check("directory: an edit goes back to pending and leaves the search", s == 200 and mine["listing"]["status"] == "pending"
          and all(x["id"] != lid for x in r), (s, s2))
    s, _ = call("DELETE", "/api/business-directory/me", member)
    s2, _ = call("DELETE", "/api/business-directory/me", member)
    check("directory: member removes the listing (then 404)", s == 204 and s2 == 404, (s, s2))
finally:
    cleanup()
    left = sql(f"SELECT (SELECT COUNT(*) FROM member_map_pins WHERE fk_member_id IN ({MEMBER},{ADMIN}))"
               f" + (SELECT COUNT(*) FROM business_listings WHERE fk_member_id IN ({MEMBER},{ADMIN}))")
    check("cleanup: no test rows left", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

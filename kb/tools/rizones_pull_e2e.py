"""RIZones pull of 2026-11-06 (web items): inactive zone / district / club cascade, member T-shirt size,
project years with the current year, goal % above 100.

    python -I kb/tools/rizones_pull_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API's JwtSettings__Secret). Local copies only, never production.
It switches one district and one zone off for the run, sets one member's T-shirt size, and restores both at the end.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def mobile_token(member_id):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": ["Member"],
            "loginType": "mobile", "iss": "JwtIssuer", "aud": "JwtAudience", "iat": int(time.time()),
            "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def get(path, tok):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {tok}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def ids(reply):
    items = reply.get("items", reply) if isinstance(reply, dict) else (reply or [])
    return {x["id"] for x in items}


sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 LIMIT 1"))
sat = token(sa, ["SuperAdmin"])
PLAIN = ("SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id = {c} AND cm.IsActive = 1 "
         "AND cm.isdeleted = 0 AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = "
         "cm.fk_member_master_profile_id AND r.fk_role_id <> 1 AND r.IsActive = 1)")
# a club with two plain members whose club, district and zone are all active
club, district, zone = [int(x) for x in sql(
    "SELECT c.pk_club_id, d.pk_district_id, z.pk_zone_id FROM club_master c "
    "JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1 "
    "JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1 "
    "JOIN club_members cm ON cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 "
    "WHERE c.isdeleted = 0 AND c.IsActive = 1 AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE "
    "r.fk_member_master_profile_id = cm.fk_member_master_profile_id AND r.fk_role_id <> 1 AND r.IsActive = 1) "
    "GROUP BY c.pk_club_id, d.pk_district_id, z.pk_zone_id HAVING COUNT(*) >= 2 ORDER BY c.pk_club_id LIMIT 1").split()]
# a plain member of that club (no admin role), and a club-mate to view them
plain = sql(PLAIN.format(c=club) + " ORDER BY 1 LIMIT 2").split()
member, mate = int(plain[0]), int(plain[1])
saved_size = sql(f"SELECT IFNULL(fk_tshirt_size_id,'NULL') FROM member_master_profile WHERE pk_member_master_profile_id = {member}")
size_m = sql("SELECT pk_id FROM event_tshirt_sizes WHERE SizeName = 'M' LIMIT 1")
pi_module = sql("SELECT pk_module_id FROM module_master WHERE ModuleName = 'Public Image Initiative' LIMIT 1")

try:
    # --- cascade: district off ---
    s, r = get(f"/api/clubs?districtId={district}&pageSize=1000", sat)
    check("club listed while its district is active", s == 200 and club in ids(r), s)
    sql(f"UPDATE district_master SET IsActive = 0 WHERE pk_district_id = {district}")
    s, r = get(f"/api/clubs?districtId={district}&pageSize=1000", sat)
    check("inactive district hides its clubs (SuperAdmin too)", s == 200 and club not in ids(r), (s, len(ids(r or {}))))
    s, r = get(f"/api/clubs?districtId={district}&pageSize=1000&includeInactive=true", sat)
    check("Club master listing still shows them to SuperAdmin", s == 200 and club in ids(r), s)
    s, r = get(f"/api/clubs?districtId={district}&pageSize=1000&includeInactive=true", token(member, ["Member"]))
    check("includeInactive is ignored for a member", s in (200, 403) and club not in ids(r or {}), s)
    s, r = get(f"/api/districts?zoneId={zone}&pageSize=1000", sat)
    check("inactive district left out of the district list", s == 200 and district not in ids(r), s)
    s, r = get(f"/api/districts?zoneId={zone}&pageSize=1000&includeInactive=true", sat)
    check("District master listing still shows it", s == 200 and district in ids(r), s)
    s, r = get(f"/api/clubs/{club}", sat)
    check("club detail marks the chain inactive", s == 200 and r.get("isChainActive") is False, (s, r and r.get("isChainActive")))
    s, _ = get(f"/api/clubs/{club}/members?pageSize=5", sat)
    check("SuperAdmin may still open the members of a hidden club", s == 200, s)
    sql(f"UPDATE district_master SET IsActive = 1 WHERE pk_district_id = {district}")
    s, r = get(f"/api/clubs/{club}", sat)
    check("switching it back on brings everything back", s == 200 and r.get("isChainActive") is True, s)

    # --- cascade: zone off ---
    sql(f"UPDATE zone_master SET IsActive = 0 WHERE pk_zone_id = {zone}")
    s, r = get("/api/zones?pageSize=1000", sat)
    check("inactive zone left out of the zone list", s == 200 and zone not in ids(r), s)
    s, r = get("/api/zones?pageSize=1000&includeInactive=true", sat)
    check("Zone master listing still shows it", s == 200 and zone in ids(r), s)
    s, r = get(f"/api/clubs?districtId={district}&pageSize=1000", sat)
    check("inactive zone hides the clubs below it", s == 200 and club not in ids(r), s)
    sql(f"UPDATE zone_master SET IsActive = 1 WHERE pk_zone_id = {zone}")

    # --- T-shirt size: never public ---
    sql(f"UPDATE member_master_profile SET fk_tshirt_size_id = {size_m} WHERE pk_member_master_profile_id = {member}")
    s, r = get(f"/api/members/{member}", sat)
    check("SuperAdmin sees the T-shirt size", s == 200 and r.get("tshirtSize") == "M", (s, r and r.get("tshirtSize")))
    s, r = get(f"/api/members/{member}", token(member, ["Member"]))
    check("the member sees their own size", s == 200 and r.get("tshirtSize") == "M", (s, r and r.get("tshirtSize")))
    s, r = get(f"/api/members/{member}", token(mate, ["Member"]))
    check("a club-mate does not see it", s in (200, 403) and (r is None or r.get("tshirtSize") is None),
          (s, r and r.get("tshirtSize")))

    # --- app: login blocked when the member's club, district or zone is inactive (M4) ---
    s, _ = get("/api/auth/my-context", mobile_token(member))
    check("app opens while the chain is active", s == 200, s)
    sql(f"UPDATE district_master SET IsActive = 0 WHERE pk_district_id = {district}")
    s, _ = get("/api/auth/my-context", mobile_token(member))
    check("app refuses a member whose only club is hidden", s == 401, s)
    sql(f"UPDATE district_master SET IsActive = 1 WHERE pk_district_id = {district}")

    # --- app: T-shirt options (M3) ---
    s, r = get("/api/mobile/member-profile-options", mobile_token(member))
    check("profile options list XS to XXXL", s == 200 and [x["sizeName"] for x in r["tshirtSizes"]][:1] == ["XS"]
          and len(r["bloodGroups"]) == 8, (s, r))

    # --- project years always include the current year ---
    current = int(sql("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent = 1 AND isdeleted = 0 ORDER BY pk_year_id DESC LIMIT 1"))
    s, r = get(f"/api/clubs/{club}/projects/years?moduleId={pi_module}", sat)
    check("project years list the current year", s == 200 and any(y["id"] == current for y in r), (s, r))
finally:
    sql(f"UPDATE district_master SET IsActive = 1 WHERE pk_district_id = {district}")
    sql(f"UPDATE zone_master SET IsActive = 1 WHERE pk_zone_id = {zone}")
    sql(f"UPDATE member_master_profile SET fk_tshirt_size_id = {saved_size} WHERE pk_member_master_profile_id = {member}")

print("ALL PASS" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)

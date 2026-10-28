"""Event time zones for screens (build spec 3.3): /api/time-zone and the zone on the club calendars.

    python -I kb/tools/event_time_zone_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Sets one district's
zone to Pacific/Kiritimati and restores it at the end. Local copies only, never production.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
ZONE = "Pacific/Kiritimati"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def sign(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def get(path, token=None):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
token = sign(sa, "SuperAdmin")
club, district = [int(x) for x in sql("""SELECT c.pk_club_id, c.fk_district_id FROM club_master c
    JOIN district_master d ON d.pk_district_id = c.fk_district_id WHERE c.isdeleted = 0 LIMIT 1""").split()]
old = sql(f"SELECT IFNULL(Timezone, '\\\\N') FROM district_master WHERE pk_district_id = {district}")
try:
    sql(f"UPDATE district_master SET Timezone = '{ZONE}' WHERE pk_district_id = {district}")
    s, b = get(f"/api/time-zone?districtId={district}", token)
    check("a district's zone is returned", s == 200 and b.get("timeZone") == ZONE, (s, b))
    s, b = get(f"/api/time-zone?clubId={club}", token)
    check("a club uses its district's zone", s == 200 and b.get("timeZone") == ZONE, (s, b))
    s, _ = get(f"/api/time-zone?clubId={club}&districtId={district}", token)
    check("both ids at once is refused", s == 400, s)
    s, _ = get(f"/api/time-zone?clubId={club}")
    check("signed out is refused", s == 401, s)
    s, b = get(f"/api/mobile/club-calendar/{club}", token)
    check("the app club calendar carries the zone", s == 200 and b.get("timeZone") == ZONE, (s, b.get("timeZone")))
    s, b = get(f"/api/mobile/district-calendar/{district}", token)
    check("the app district calendar carries the zone", s == 200 and b.get("timeZone") == ZONE, (s, b.get("timeZone")))
    s, b = get(f"/api/public/club/{club}/calendar")
    check("the public club calendar carries the zone (or the club has no public site)",
          (s == 200 and b.get("timeZone") == ZONE) or s == 404, (s, b.get("timeZone")))
finally:
    restore = "NULL" if old == "\\N" else "'" + old.replace("'", "''") + "'"
    sql(f"UPDATE district_master SET Timezone = {restore} WHERE pk_district_id = {district}")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

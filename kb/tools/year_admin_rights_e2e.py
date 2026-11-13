"""Year-wise Admin Rights (RIZones pull 2026-11-06): the per-scope switch, the year guard, SuperAdmin-only settings.

    python -I kb/tools/year_admin_rights_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET. Local copies only, never production. Needs the grants from
row/database/maintenance/2026-11-09-year-wise-admin-rights.sql. It switches the rule on for one club and parks
one admin's grant for the run, then restores both. The write it tries carries an empty name, so even when the
guard lets it through, validation refuses it and nothing is saved.
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


def call(method, path, tok, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"null")
        except ValueError:
            return e.code, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 LIMIT 1"))
sat = token(sa, ["SuperAdmin"])
# a Club Admin with an All-Years grant, in a club whose chain is active and who holds no board office
# (a President / Secretary gets the current year from the board of directors, not from grants)
row = sql("SELECT g.pk_member_admin_year_id, g.fk_member_master_profile_id, g.fk_club_id FROM member_admin_years g "
          "JOIN club_master c ON c.pk_club_id = g.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1 "
          "JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.IsActive = 1 "
          "WHERE g.AllYears = 1 AND g.IsActive = 1 AND g.fk_club_id > 0 AND NOT EXISTS (SELECT 1 FROM "
          "board_of_directors b WHERE b.fk_member_master_profile_id = g.fk_member_master_profile_id AND b.isdeleted = 0) "
          "AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id = g.fk_member_master_profile_id "
          "AND r.fk_role_id = 3 AND r.IsActive = 1) ORDER BY g.pk_member_admin_year_id LIMIT 1").split()
grant, admin, club = int(row[0]), int(row[1]), int(row[2])
at = token(admin, ["Admin"])
path = f"/api/clubs/{club}/potential-members"

try:
    s, _ = call("GET", "/api/settings/year-rule", sat)
    check("SuperAdmin reads the year-rule settings", s == 200, s)
    s, _ = call("GET", "/api/settings/year-rule", at)
    check("an Admin cannot read them", s == 403, s)
    s, _ = call("PUT", f"/api/settings/year-rule/club/{club}", at, {"isEnabled": True})
    check("an Admin cannot switch the rule", s == 403, s)

    # rule OFF (platform default): an admin with no grant still passes the year check
    sql(f"UPDATE member_admin_years SET IsActive = 0 WHERE pk_member_admin_year_id = {grant}")
    s, r = call("POST", path, at, {"name": ""})
    check("rule off: no year refusal (validation answers instead)", s == 400, (s, r))

    # rule ON for this club, no grant: refused before anything else
    s, _ = call("PUT", f"/api/settings/year-rule/club/{club}", sat, {"isEnabled": True, "notes": "e2e"})
    check("SuperAdmin switches the rule on for one club", s == 200, s)
    s, r = call("POST", path, at, {"name": ""})
    check("rule on, no year held: write refused with 403", s == 403, (s, r))

    # rule ON with the All-Years grant back: the year check passes again
    sql(f"UPDATE member_admin_years SET IsActive = 1 WHERE pk_member_admin_year_id = {grant}")
    s, r = call("POST", path, at, {"name": ""})
    check("rule on, All Years held: passes the year check", s == 400, (s, r))
finally:
    sql(f"UPDATE member_admin_years SET IsActive = 1 WHERE pk_member_admin_year_id = {grant}")
    call("DELETE", f"/api/settings/year-rule/club/{club}", sat)

print("ALL PASS" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)

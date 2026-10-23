"""Tenant lifecycle and editions (ROW Wave 1, task 5).

    python -I kb/tools/tenant_lifecycle_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). The SuperAdmin and a
club admin are picked by query; the district is the smallest one (two clubs or more) where a club admin exists. Sets
the district's subscription, edits the district and club_basic editions, applies them and checks the planning state.
Local copies only, never production. Everything it changes is copied to e2e_tl_* tables first and put back at the
end: both editions, the district's subscriptions, its district and club module switches and the test club's type.
audit_log rows stay (the table is append-only by design).
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


def sign(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


CLUBS_OF = "(SELECT COUNT(*) FROM club_master x WHERE x.fk_district_id=c.fk_district_id AND x.isdeleted=0)"
admin_id, club0, district = [int(x) for x in sql(
    "SELECT r.fk_member_master_profile_id, r.fk_club_id, c.fk_district_id FROM member_roles r "
    "JOIN club_master c ON c.pk_club_id=r.fk_club_id AND c.isdeleted=0 "
    f"WHERE r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0 AND {CLUBS_OF} >= 2 ORDER BY {CLUBS_OF}, 1, 2 LIMIT 1").split()]
sa = sign(int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")), "SuperAdmin")
admin = sign(admin_id, "Admin")
clubs = [int(x) for x in sql(f"SELECT pk_club_id FROM club_master WHERE isdeleted=0 AND fk_district_id={district} ORDER BY 1").split()]
rotaract = max(c for c in clubs if c != club0)
ids = ",".join(map(str, clubs))
current = int(sql("SELECT pk_year_id FROM rotary_year_master WHERE isdeleted=0 AND IsCurrent=1 LIMIT 1"))
dkeys = sql("SELECT ModuleKey FROM module_master WHERE isdeleted=0 AND ModuleLevel IN ('District','Both') ORDER BY SortOrder LIMIT 3").split()
ckeys = sql("SELECT ModuleKey FROM module_master WHERE isdeleted=0 AND ModuleLevel IN ('Club','Both') ORDER BY SortOrder LIMIT 2").split()
EDS = "('district','club_basic')"
BAK = {"e2e_tl_ed": f"SELECT * FROM edition_catalogue WHERE code IN {EDS}",
       "e2e_tl_em": f"SELECT * FROM edition_modules WHERE edition_code IN {EDS}",
       "e2e_tl_ts": f"SELECT * FROM tenant_subscriptions WHERE fk_district_id={district}",
       "e2e_tl_dm": f"SELECT pk_district_module_id, IsEnabled FROM district_modules WHERE fk_district_id={district}",
       "e2e_tl_cm": f"SELECT pk_club_module_id, IsEnabled FROM club_modules WHERE fk_club_id IN ({ids})",
       "e2e_tl_club": f"SELECT pk_club_id, ClubType FROM club_master WHERE pk_club_id={rotaract}"}
sql("; ".join(f"DROP TABLE IF EXISTS {t}; CREATE TABLE {t} AS {q}" for t, q in BAK.items()))
# provisioning keeps an existing club row (INSERT IGNORE), so the district's clubs are provisioned fresh
sql(f"UPDATE club_master SET ClubType='Rotaract Club' WHERE pk_club_id={rotaract}; DELETE FROM tenant_subscriptions WHERE fk_district_id={district}")
sub = {"editionCode": "district", "memberBand": "1-1500", "termStart": "2026-07-01", "termEnd": "2027-06-30",
       "state": "planning", "region": "APAC", "setupFeeWaived": True, "platformFeePct": 2.5, "platformFeeFixed": 0.3}

try:
    s, eds = call("GET", "/api/editions", token=sa)
    codes = {e.get("code") for e in eds} if isinstance(eds, list) else set()
    check("the five editions are listed", {"district", "club", "club_basic", "rotaract", "zone"} <= codes, (s, eds))
    s, b = call("GET", "/api/editions", token=admin)
    check("a club admin cannot read editions", s == 403, (s, b))

    s, b = call("PUT", "/api/editions/district", {"name": "District", "moduleKeys": dkeys}, sa)
    check("SuperAdmin sets the district edition's modules", s == 200, (s, b))
    s, b = call("PUT", "/api/editions/club_basic", {"name": "Club basic", "moduleKeys": ckeys[:1]}, sa)
    check("SuperAdmin sets the club_basic edition's modules", s == 200, (s, b))
    s, b = call("PUT", "/api/editions/club_basic", {"name": "Club basic", "moduleKeys": ["no_such_module"]}, sa)
    check("an unknown module key is refused", s == 400, (s, b))
    s, b = call("PUT", "/api/editions/club_basic", {"name": "Club basic", "moduleKeys": ckeys[:1]}, admin)
    check("a club admin cannot edit editions", s == 403, (s, b))

    s, b = call("PUT", f"/api/tenants/{district}", {**sub, "platformFeePct": 120}, sa)
    check("a fee over 100% is refused", s == 400, (s, b))
    s, b = call("PUT", f"/api/tenants/{district}", {**sub, "termEnd": "2026-01-01"}, sa)
    check("a term ending before it starts is refused", s == 400, (s, b))
    s, b = call("PUT", f"/api/tenants/{district}", sub, admin)
    check("a club admin cannot set a subscription", s == 403, (s, b))
    s, b = call("PUT", f"/api/tenants/{district}", sub, sa)
    check("SuperAdmin sets the district subscription", s == 200, (s, b))
    s, t = call("GET", f"/api/tenants/{district}", token=sa)
    by_club = {c.get("clubId"): c.get("editionCode") for c in t.get("clubs", [])}
    check("every club is provisioned (club_basic, rotaract for Rotaract)",
          all(by_club.get(c) == ("rotaract" if c == rotaract else "club_basic") for c in clubs), t)

    # a module data row the edition switches off must survive (on/off only)
    off_key = sql(f"SELECT m.ModuleKey FROM club_modules cm JOIN module_master m ON m.pk_module_id=cm.fk_module_id "
                  f"WHERE cm.fk_club_id={club0} AND m.ModuleKey NOT IN ('{ckeys[0]}') LIMIT 1")
    s, b = call("POST", f"/api/tenants/{district}/apply-edition", {}, sa)
    check("SuperAdmin applies the editions", s == 200, (s, b))
    on = set(sql(f"SELECT m.ModuleKey FROM district_modules dm JOIN module_master m ON m.pk_module_id=dm.fk_module_id "
                 f"WHERE dm.fk_district_id={district} AND dm.IsEnabled=1").split())
    check("district modules switched to the district edition", on == set(dkeys), (on, dkeys))
    on = set(sql(f"SELECT m.ModuleKey FROM club_modules cm JOIN module_master m ON m.pk_module_id=cm.fk_module_id "
                 f"WHERE cm.fk_club_id={club0} AND cm.IsEnabled=1").split())
    check("club modules switched to club_basic", on == {ckeys[0]}, (on, ckeys[0]))
    if off_key:
        kept = sql(f"SELECT COUNT(*) FROM club_modules cm JOIN module_master m ON m.pk_module_id=cm.fk_module_id "
                   f"WHERE cm.fk_club_id={club0} AND m.ModuleKey='{off_key}' AND cm.IsEnabled=0")
        check("a switched-off module keeps its row (disabled, not deleted)", kept == "1", off_key)

    s, st = call("GET", f"/api/tenants/{district}/state", token=admin)
    check("a signed-in admin reads the planning state", s == 200 and st.get("state") == "planning", (s, st))
    s, b = call("PUT", f"/api/clubs/{club0}/projects/{current}/999999", {}, admin)
    check("planning refuses a current-year write", s == 409, (s, b))
    s, b = call("PUT", f"/api/clubs/{club0}/projects/{current + 1}/999999", {}, admin)
    check("planning allows a next-year write", s != 409, (s, b))
    s, b = call("PUT", f"/api/districts/{district}/projects/{current}/999999", {}, sa)
    check("planning refuses a current-year district write", s == 409, (s, b))

    call("PUT", f"/api/tenants/{district}", {**sub, "state": "live"}, sa)
    s, b = call("PUT", f"/api/clubs/{club0}/projects/{current}/999999", {}, admin)
    check("live allows a current-year write", s != 409, (s, b))
    n = sql(f"SELECT COUNT(*) FROM audit_log WHERE entity_type IN ('tenant_subscription','edition') AND created_date > NOW() - INTERVAL 5 MINUTE")
    check("tenant and edition changes are audited", int(n or 0) >= 4, n)
finally:
    sql("START TRANSACTION; "
        "UPDATE edition_catalogue e JOIN e2e_tl_ed b ON b.code=e.code SET e.name=b.name, e.modified_by=b.modified_by, e.modified_date=b.modified_date; "
        f"DELETE FROM edition_modules WHERE edition_code IN {EDS}; INSERT INTO edition_modules SELECT * FROM e2e_tl_em; "
        f"DELETE FROM tenant_subscriptions WHERE fk_district_id={district}; INSERT INTO tenant_subscriptions SELECT * FROM e2e_tl_ts; "
        "UPDATE district_modules dm JOIN e2e_tl_dm b ON b.pk_district_module_id=dm.pk_district_module_id SET dm.IsEnabled=b.IsEnabled; "
        f"DELETE FROM district_modules WHERE fk_district_id={district} AND pk_district_module_id NOT IN (SELECT pk_district_module_id FROM e2e_tl_dm); "
        "UPDATE club_modules cm JOIN e2e_tl_cm b ON b.pk_club_module_id=cm.pk_club_module_id SET cm.IsEnabled=b.IsEnabled; "
        f"DELETE FROM club_modules WHERE fk_club_id IN ({ids}) AND pk_club_module_id NOT IN (SELECT pk_club_module_id FROM e2e_tl_cm); "
        "UPDATE club_master c JOIN e2e_tl_club b ON b.pk_club_id=c.pk_club_id SET c.ClubType=b.ClubType; "
        "COMMIT; " + "; ".join(f"DROP TABLE {t}" for t in BAK))

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

"""Tenant lifecycle and editions (ROW Wave 1, task 5).

    python kb/tools/tenant_lifecycle_e2e.py [api_base] [mysql_port]
Dev database only: sets the demo district's subscription, edits the district and club_basic editions, applies them,
and checks the planning state. Puts the district back to 'live' at the end. Run scope_write_guard_e2e.py first once
(it gives samuel.tubman@monrovia.demo his club admin password).
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
PORT = sys.argv[2] if len(sys.argv) > 2 else "3317"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", "row_local", "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


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


# SuperAdmin login from the environment (never commit real credentials): ROW_E2E_SA_EMAIL, ROW_E2E_SA_PASSWORD.
sa = call("POST", "/api/auth/login", {"email": os.environ["ROW_E2E_SA_EMAIL"], "password": os.environ["ROW_E2E_SA_PASSWORD"]})[1].get("token", "")
admin = call("POST", "/api/auth/login", {"email": "samuel.tubman@monrovia.demo", "password": os.environ["ROW_E2E_ADMIN_PASSWORD"]})[1].get("token", "")
district = int(sql("SELECT pk_district_id FROM district_master WHERE isdeleted=0 ORDER BY 1 LIMIT 1"))
clubs = [int(x) for x in sql(f"SELECT pk_club_id FROM club_master WHERE isdeleted=0 AND fk_district_id={district} ORDER BY 1").split()]
rotaract = clubs[-1]
old_type = sql(f"SELECT COALESCE(ClubType,'') FROM club_master WHERE pk_club_id={rotaract}")
sql(f"UPDATE club_master SET ClubType='Rotaract Club' WHERE pk_club_id={rotaract}")
# provisioning keeps an existing club row (INSERT IGNORE), so let the test club be provisioned fresh
sql(f"DELETE FROM tenant_subscriptions WHERE fk_club_id={rotaract}")
current = int(sql("SELECT pk_year_id FROM rotary_year_master WHERE isdeleted=0 AND IsCurrent=1 LIMIT 1"))
dkeys = sql("SELECT ModuleKey FROM module_master WHERE isdeleted=0 AND ModuleLevel IN ('District','Both') ORDER BY SortOrder LIMIT 3").split()
ckeys = sql("SELECT ModuleKey FROM module_master WHERE isdeleted=0 AND ModuleLevel IN ('Club','Both') ORDER BY SortOrder LIMIT 2").split()
ids = ",".join(map(str, clubs))
was_on = (sql(f"SELECT GROUP_CONCAT(pk_district_module_id) FROM district_modules WHERE fk_district_id={district} AND IsEnabled=1"),
          sql(f"SELECT GROUP_CONCAT(pk_club_module_id) FROM club_modules WHERE fk_club_id IN ({ids}) AND IsEnabled=1"))
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
                  f"WHERE cm.fk_club_id={clubs[0]} AND m.ModuleKey NOT IN ('{ckeys[0]}') LIMIT 1")
    s, b = call("POST", f"/api/tenants/{district}/apply-edition", {}, sa)
    check("SuperAdmin applies the editions", s == 200, (s, b))
    on = set(sql(f"SELECT m.ModuleKey FROM district_modules dm JOIN module_master m ON m.pk_module_id=dm.fk_module_id "
                 f"WHERE dm.fk_district_id={district} AND dm.IsEnabled=1").split())
    check("district modules switched to the district edition", on == set(dkeys), (on, dkeys))
    on = set(sql(f"SELECT m.ModuleKey FROM club_modules cm JOIN module_master m ON m.pk_module_id=cm.fk_module_id "
                 f"WHERE cm.fk_club_id={clubs[0]} AND cm.IsEnabled=1").split())
    check("club modules switched to club_basic", on == {ckeys[0]}, (on, ckeys[0]))
    if off_key:
        kept = sql(f"SELECT COUNT(*) FROM club_modules cm JOIN module_master m ON m.pk_module_id=cm.fk_module_id "
                   f"WHERE cm.fk_club_id={clubs[0]} AND m.ModuleKey='{off_key}' AND cm.IsEnabled=0")
        check("a switched-off module keeps its row (disabled, not deleted)", kept == "1", off_key)

    s, st = call("GET", f"/api/tenants/{district}/state", token=admin)
    check("a signed-in admin reads the planning state", s == 200 and st.get("state") == "planning", (s, st))
    s, b = call("PUT", f"/api/clubs/{clubs[0]}/projects/{current}/999999", {}, admin)
    check("planning refuses a current-year write", s == 409, (s, b))
    s, b = call("PUT", f"/api/clubs/{clubs[0]}/projects/{current + 1}/999999", {}, admin)
    check("planning allows a next-year write", s != 409, (s, b))
    s, b = call("PUT", f"/api/districts/{district}/projects/{current}/999999", {}, sa)
    check("planning refuses a current-year district write", s == 409, (s, b))

    call("PUT", f"/api/tenants/{district}", {**sub, "state": "live"}, sa)
    s, b = call("PUT", f"/api/clubs/{clubs[0]}/projects/{current}/999999", {}, admin)
    check("live allows a current-year write", s != 409, (s, b))
    n = sql(f"SELECT COUNT(*) FROM audit_log WHERE entity_type IN ('tenant_subscription','edition') AND created_date > NOW() - INTERVAL 5 MINUTE")
    check("tenant and edition changes are audited", int(n or 0) >= 4, n)
finally:
    call("PUT", f"/api/tenants/{district}", {**sub, "state": "live"}, sa)
    # put the demo module switches back as they were
    sql(f"UPDATE district_modules SET IsEnabled = pk_district_module_id IN ({was_on[0] if was_on[0] != 'NULL' else 0}) WHERE fk_district_id={district}")
    sql(f"UPDATE club_modules SET IsEnabled = pk_club_module_id IN ({was_on[1] if was_on[1] != 'NULL' else 0}) WHERE fk_club_id IN ({ids})")
    sql(f"UPDATE club_master SET ClubType={'NULL' if not old_type else repr(old_type)} WHERE pk_club_id={rotaract}")
    if not old_type:  # the club was only Rotaract for this test
        sql(f"UPDATE tenant_subscriptions SET edition_code='club_basic' WHERE fk_club_id={rotaract} AND edition_code='rotaract'")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

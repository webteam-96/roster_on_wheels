"""District target setting (build spec B.29): the district proposes per club, the club accepts or counters.

    python -I kb/tools/district_targets_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Local copies only.
Switches target_dashboard on for the run (the API caches switches for 30 seconds, so it waits) and restores it;
removes its proposals at the end.
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
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, token, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


sa = sign(int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")), "SuperAdmin")
# a club admin (role 2 on one club) and the club's district
admin, club, district = [int(x) for x in sql("""SELECT mr.fk_member_master_profile_id, mr.fk_club_id, c.fk_district_id
    FROM member_roles mr JOIN club_master c ON c.pk_club_id = mr.fk_club_id AND c.isdeleted = 0
    WHERE mr.fk_role_id = 2 AND mr.fk_club_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0
      AND NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id = mr.fk_member_master_profile_id
                      AND x.IsActive = 1 AND x.isdeleted = 0 AND (x.fk_role_id = 3 OR (x.fk_role_id = 2 AND IFNULL(x.fk_club_id, 0) = 0)))
    LIMIT 1""").split()]
other = int(sql(f"SELECT pk_club_id FROM club_master WHERE isdeleted = 0 AND fk_district_id = {district} AND pk_club_id <> {club} LIMIT 1") or 0)
club_admin = sign(admin, "Admin")
was = sql("SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='target_dashboard'")
try:
    call("PUT", "/api/features/target_dashboard", sa, {"enabled": True})
    base_d = f"/api/districts/{district}/targets/proposals"
    s, b = call("PUT", base_d, sa, {"clubId": club, "metric": "membership_growth", "value": 5})
    check("the district proposes a club target", s == 200 and b.get("status") == "proposed" and b.get("proposedValue") == 5, (s, b))
    pid = b.get("id")
    s, _ = call("PUT", base_d, sa, {"clubId": club, "metric": "fun", "value": 5})
    check("an unknown target is refused", s == 400, s)
    s, _ = call("PUT", base_d, club_admin, {"clubId": club, "metric": "meetings", "value": 40})
    check("a club admin cannot propose", s == 403, s)
    s, rows = call("GET", f"/api/clubs/{club}/targets/proposals", club_admin)
    check("the club sees its proposal", s == 200 and any(r["id"] == pid for r in rows), (s, rows))
    s, b = call("POST", f"/api/clubs/{club}/targets/proposals/{pid}/counter", club_admin, {"value": 3, "note": "Two members are moving away."})
    check("the club counters with its own value", s == 200 and b.get("status") == "countered" and b.get("counterValue") == 3, (s, b))
    s, rows = call("GET", base_d, sa)
    row = next((r for r in rows if r["id"] == pid), {})
    check("the district sees the counter and the note", row.get("status") == "countered" and "moving" in (row.get("clubNote") or ""), row)
    s, b = call("PUT", base_d, sa, {"clubId": club, "metric": "membership_growth", "value": 4})
    check("a new proposal restarts the answer", b.get("status") == "proposed" and b.get("counterValue") is None, b)
    s, b = call("POST", f"/api/clubs/{club}/targets/proposals/{pid}/accept", club_admin)
    check("the club accepts", s == 200 and b.get("status") == "accepted", (s, b))
    if other:
        s, _ = call("POST", f"/api/clubs/{other}/targets/proposals/{pid}/accept", sa)
        check("a proposal cannot be answered through another club's URL", s == 404, s)
    plain = int(sql(f"""SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id = {club}
        AND cm.IsActive = 1 AND cm.isdeleted = 0 AND NOT EXISTS (SELECT 1 FROM member_roles r
        WHERE r.fk_member_master_profile_id = cm.fk_member_master_profile_id AND r.fk_role_id IN (2, 3)
          AND r.IsActive = 1 AND r.isdeleted = 0) LIMIT 1"""))
    s, _ = call("GET", f"/api/clubs/{club}/targets/proposals", sign(plain, "Member"))
    check("a plain member is refused", s == 403, s)
    call("PUT", "/api/features/target_dashboard", sa, {"enabled": False})
    time.sleep(31)  # the API caches the switches for 30 seconds
    s, _ = call("GET", base_d, sa)
    check("switched off, the proposals are gone (404)", s == 404, s)
finally:
    sql(f"DELETE FROM district_target_proposals WHERE fk_club_id = {club}")
    call("PUT", "/api/features/target_dashboard", sa, {"enabled": was == "1"})

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

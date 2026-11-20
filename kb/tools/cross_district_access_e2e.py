"""Time-limited cross-district access: a SuperAdmin grants member 999 read (then write) on another district, the
grant works only inside its window, only on its allow-listed paths, stops at revoke and at expiry (no job), and
every grant / use / revoke is in audit_log.

    python -I kb/tools/cross_district_access_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Writes to the given LOCAL
database only: grant rows and one test weblink, both removed at the end. audit_log rows stay (append-only by design).
No email or push is sent: weblinks notify no one. Never run it against production.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.parse, urllib.request, uuid

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
MARK = 'e2e-cross-district-' + uuid.uuid4().hex[:8]
GRANTEE, SA = 999, 1
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(v) if v and v != 'NULL' else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok, body=None, form=None):
    h = {"Authorization": f"Bearer {tok}"}
    data = None
    if form is not None:  # the weblink endpoints take multipart/form-data
        b = uuid.uuid4().hex
        data = "".join(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in form.items()).encode() + f"--{b}--\r\n".encode()
        h["Content-Type"] = f"multipart/form-data; boundary={b}"
    elif body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    try:
        return status, json.loads(raw or b"{}")
    except ValueError:
        return status, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


def iso(seconds_from_now):
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + seconds_from_now))


def audits(grant_id, action):
    return one(f"SELECT COUNT(*) FROM audit_log WHERE entity_type='cross_district_access' AND entity_id={int(grant_id)} AND action='{action}'") or 0


grant_ids = []
try:
    home = one(f"SELECT c.fk_district_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id "
               f"WHERE cm.fk_member_master_profile_id={GRANTEE} AND cm.IsActive=1 LIMIT 1")
    target = one(f"SELECT pk_district_id FROM district_master WHERE IFNULL(isdeleted,0)=0 AND IFNULL(IsActive,1)=1 "
                 f"AND pk_district_id <> {home} AND pk_district_id IN (SELECT fk_district_id FROM club_master WHERE IFNULL(isdeleted,0)=0) "
                 f"AND pk_district_id NOT IN (SELECT fk_district_id FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id "
                 f"WHERE cm.fk_member_master_profile_id={GRANTEE}) ORDER BY pk_district_id LIMIT 1")
    club = one(f"SELECT pk_club_id FROM club_master WHERE fk_district_id={target} AND IFNULL(isdeleted,0)=0 ORDER BY pk_club_id LIMIT 1")
    other = one(f"SELECT pk_district_id FROM district_master WHERE pk_district_id NOT IN ({home},{target}) AND IFNULL(isdeleted,0)=0 LIMIT 1")
    sql(f"DELETE FROM district_access_grants WHERE fk_member_id={GRANTEE}")  # leftovers of an aborted run
    print(f"grantee {GRANTEE} (home district {home}) -> target district {target}, club {club}")
    sa, me = token(SA, ["SuperAdmin"]), token(GRANTEE, ["Member"])
    READ = f"/api/districts/{target}/weblinks"

    # Before any grant
    check("before grant: district read refused", call("GET", READ, me)[0] == 403)
    check("before grant: club in that district refused", call("GET", f"/api/clubs/{club}/weblinks", me)[0] == 403)
    s, _ = call("GET", "/api/district-access-grants", me)
    check("ordinary member cannot list grants", s == 403, s)
    s, _ = call("POST", "/api/district-access-grants", me, {"memberId": GRANTEE, "districtId": target, "canWrite": True,
              "purpose": "PETS", "startsAtUtc": iso(0), "expiresAtUtc": iso(3600)})
    check("ordinary member cannot grant (not even to self)", s == 403, s)

    # Validation
    base = {"memberId": GRANTEE, "districtId": target, "canWrite": False, "purpose": "PETS", "startsAtUtc": iso(0), "expiresAtUtc": iso(86400)}
    check("bad purpose -> 400", call("POST", "/api/district-access-grants", sa, {**base, "purpose": "ADMIN"})[0] == 400)
    check("expiry before start -> 400", call("POST", "/api/district-access-grants", sa, {**base, "expiresAtUtc": iso(-60)})[0] == 400)
    check("over a year -> 400", call("POST", "/api/district-access-grants", sa, {**base, "expiresAtUtc": iso(400 * 86400)})[0] == 400)
    check("grant to self -> 400", call("POST", "/api/district-access-grants", sa, {**base, "memberId": SA})[0] == 400)
    check("unknown district -> 400", call("POST", "/api/district-access-grants", sa, {**base, "districtId": 99999999})[0] == 400)

    # Read grant
    s, r = call("POST", "/api/district-access-grants", sa, {**base, "note": MARK})
    check("SuperAdmin creates a read grant", s == 200 and r.get("id"), r)
    g1 = r.get("id"); grant_ids.append(g1)
    check("GRANT written to audit_log", audits(g1, "GRANT") == 1)
    check("duplicate live grant -> 409", call("POST", "/api/district-access-grants", sa, base)[0] == 409)
    s, _ = call("GET", READ, me)
    check("with read grant: district read allowed", s == 200, s)
    check("USE_READ written to audit_log", audits(g1, "USE_READ") >= 1)
    check("with read grant: club in district readable", call("GET", f"/api/clubs/{club}/weblinks", me)[0] == 200)
    check("read grant does not open another district", call("GET", f"/api/districts/{other}/weblinks", me)[0] == 403)
    s, _ = call("POST", READ, me, form={"Title": MARK, "LinkType": "None"})
    check("read grant cannot write", s == 403, s)
    s, mine = call("GET", "/api/district-access-grants/mine", me)
    check("grantee sees the extra district in /mine", s == 200 and any(x["districtId"] == target for x in mine), mine)
    s, lst = call("GET", "/api/district-access-grants?status=live", sa)
    check("admin list shows the live grant", s == 200 and any(x["id"] == g1 for x in lst.get("items", [])), lst)

    # Revoke
    s, _ = call("POST", f"/api/district-access-grants/{g1}/revoke", me, {"reason": "x"})
    check("grantee cannot revoke", s == 403, s)
    s, _ = call("POST", f"/api/district-access-grants/{g1}/revoke", sa, {"reason": MARK})
    check("SuperAdmin revokes", s == 200, s)
    check("REVOKE written to audit_log", audits(g1, "REVOKE") == 1)
    check("after revoke: district read refused", call("GET", READ, me)[0] == 403)
    check("revoke twice -> 409", call("POST", f"/api/district-access-grants/{g1}/revoke", sa, {})[0] == 409)
    check("revoked grant gone from /mine", all(x["id"] != g1 for x in call("GET", "/api/district-access-grants/mine", me)[1]))

    # Write grant
    s, r = call("POST", "/api/district-access-grants", sa, {**base, "canWrite": True, "purpose": "ZONE", "note": MARK})
    check("SuperAdmin creates a write grant", s == 200, r)
    g2 = r.get("id"); grant_ids.append(g2)
    s, r = call("POST", READ, me, form={"Title": MARK, "LinkType": "None", "SortOrder": "0"})
    check("write grant: create a district weblink", s == 200, (s, r))
    wl = one(f"SELECT pk_weblink_id FROM weblinks WHERE Title='{MARK}' ORDER BY pk_weblink_id DESC LIMIT 1")
    check("USE_WRITE written to audit_log", audits(g2, "USE_WRITE") >= 1)
    if wl:
        s, r = call("DELETE", f"{READ}/{wl}", me)
        check("write grant: delete that weblink", s == 200, r)
    for path, label in [(f"/api/districts/{target}/members/{SA}/assign-admin", "assign admin"),
                        (f"/api/districts/{target}/ag", "AG"),
                        (f"/api/districts/{target}/mass-emails", "mass email"),
                        (f"/api/districts/{target}/website-data/contact-details", "website"),
                        (f"/api/clubs/{club}/weblinks", "club write"),
                        (f"/api/districts/{other}/weblinks", "another district")]:
        s, _ = call("POST", path, me, body={})
        check(f"write grant never reaches {label}", s == 403, s)

    # Expiry: no job, the clock alone ends it
    sql(f"UPDATE district_access_grants SET expires_at_utc = UTC_TIMESTAMP() - INTERVAL 1 SECOND, starts_at_utc = UTC_TIMESTAMP() - INTERVAL 1 HOUR WHERE pk_grant_id={int(g2)}")
    check("after expiry: district read refused", call("GET", READ, me)[0] == 403)
    check("after expiry: write refused", call("POST", READ, me, form={"Title": MARK, "LinkType": "None"})[0] == 403)
    s, lst = call("GET", "/api/district-access-grants?status=expired", sa)
    check("admin list marks it expired", any(x["id"] == g2 and x["status"] == "expired" for x in lst.get("items", [])), lst)

    # Not started yet
    s, r = call("POST", "/api/district-access-grants", sa, {**base, "startsAtUtc": iso(86400), "expiresAtUtc": iso(2 * 86400)})
    check("scheduled grant created", s == 200, r)
    g3 = r.get("id"); grant_ids.append(g3)
    check("before start: district read refused", call("GET", READ, me)[0] == 403)
    sql(f"UPDATE district_access_grants SET starts_at_utc = UTC_TIMESTAMP() - INTERVAL 1 MINUTE, expires_at_utc = UTC_TIMESTAMP() + INTERVAL 2 DAY WHERE pk_grant_id={int(g3)}")
    check("expiring-soon warning counted", call("GET", "/api/district-access-grants", sa)[1].get("counts", {}).get("expiring", 0) >= 1)
    check("once started: district read allowed", call("GET", READ, me)[0] == 200)
finally:
    ids = ",".join(str(int(i)) for i in grant_ids if i)
    if ids:
        sql(f"DELETE FROM district_access_grants WHERE pk_grant_id IN ({ids})")
    sql(f"DELETE FROM weblinks WHERE Title='{MARK}'")
    left = one(f"SELECT COUNT(*) FROM weblinks WHERE Title='{MARK}'") or 0
    check("cleanup: test rows removed", left == 0 and (not ids or one(f"SELECT COUNT(*) FROM district_access_grants WHERE pk_grant_id IN ({ids})") == 0))

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

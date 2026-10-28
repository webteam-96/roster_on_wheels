"""RI fields (build spec 3.12): RI officer titles on designations, the ri_codes lists, and each membership's codes.

    python -I kb/tools/ri_fields_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Local copies only.
Adds test codes and one test member, sets a designation's RI title and puts it back; the test member and membership
stay soft-deleted (triggers refuse hard deletes), audit rows stay.
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TAG = "e2e" + secrets.token_hex(3)
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


sa_id = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1"))
sa, member = sign(sa_id, "SuperAdmin"), sign(1, "Member")
club = int(sql("SELECT pk_club_id FROM club_master WHERE isdeleted = 0 AND IsActive = 1 ORDER BY pk_club_id LIMIT 1"))
desig = sql("SELECT CONCAT(pk_designation_id, '|', designation_name, '|', sort_order) FROM designation_master WHERE designation_name = 'Club Secretary' AND isdeleted = 0 LIMIT 1")
code_ids, mid = [], None
try:
    s, rows = call("GET", "/api/ri-codes", member)
    check("any signed-in user reads the RI lists", s == 200 and any(r["code"] == "active" for r in rows), (s, rows))
    s, _ = call("POST", "/api/ri-codes", member, {"kind": "join_reason", "code": TAG, "label": "x", "sortOrder": 1})
    check("only Super Admin adds codes", s == 403, s)
    s, b = call("POST", "/api/ri-codes", sa, {"kind": "join_reason", "code": TAG + "j", "label": "E2E join", "sortOrder": 1})
    check("Super Admin adds a join reason", s == 200 and b.get("id"), (s, b)); code_ids.append(b.get("id"))
    s, b = call("POST", "/api/ri-codes", sa, {"kind": "termination_reason", "code": TAG + "t", "label": "E2E left", "sortOrder": 1})
    check("Super Admin adds a termination reason", s == 200 and b.get("id"), (s, b)); code_ids.append(b.get("id"))
    s, _ = call("POST", "/api/ri-codes", sa, {"kind": "join_reason", "code": TAG + "j", "label": "dup", "sortOrder": 2})
    check("a duplicate code is refused", s == 409, s)
    s, _ = call("POST", "/api/ri-codes", sa, {"kind": "colour", "code": TAG, "label": "x", "sortOrder": 1})
    check("an unknown list is refused", s == 400, s)

    if desig:
        did, dname, dsort = desig.split("|")
        s, b = call("PUT", f"/api/designations/{did}", sa, {"designationName": dname, "sortOrder": int(dsort), "riTitle": "Bishop"})
        check("a designation can only map to one of the six RI titles", s == 400, (s, b))
        s, rows = call("GET", "/api/designations", sa)
        check("designations carry their RI title", any(r.get("riTitle") == "Secretary" for r in rows), rows[:3])

    mid = int(sql(f"INSERT INTO member_master_profile (MemberName) VALUES ('{TAG} member'); SELECT LAST_INSERT_ID();"))
    sql(f"INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, IsActive, isdeleted) VALUES ({club}, {mid}, 1, 0)")
    base = f"/api/clubs/{club}/members/{mid}/ri-fields"
    s, b = call("PUT", base, sa, {"riMemberType": "honorary", "joinReasonCode": TAG + "j"})
    check("a membership gets its RI member type and join reason", s == 200, (s, b))
    s, b = call("GET", base, sa)
    check("they are read back", b.get("riMemberType") == "honorary" and b.get("joinReasonCode") == TAG + "j", b)
    s, _ = call("PUT", base, sa, {"riMemberType": "nonsense", "joinReasonCode": None})
    check("a code outside the lists is refused", s == 400, s)
    s, _ = call("DELETE", f"/api/clubs/{club}/members/{mid}?reasonCode=nonsense", sa)
    check("removal with an unknown termination code is refused", s == 400, s)
    q = urllib.parse.urlencode({"reason": "Moved away", "reasonCode": TAG + "t"})
    s, _ = call("DELETE", f"/api/clubs/{club}/members/{mid}?{q}", sa)
    check("removal stores the termination reason code", s == 204 and sql(
        f"SELECT termination_reason_code FROM club_members WHERE fk_club_id={club} AND fk_member_master_profile_id={mid}") == TAG + "t", s)
    s, _ = call("DELETE", f"/api/ri-codes/{code_ids[0]}", sa)
    s2, rows = call("GET", "/api/ri-codes", member)
    check("a deleted code leaves the list", s == 204 and not any(r["code"] == TAG + "j" for r in rows), (s, s2))
finally:
    sql(f"DELETE FROM ri_codes WHERE code LIKE '{TAG}%'")
    if mid:
        sql(f"UPDATE club_members SET isdeleted = 1 WHERE fk_member_master_profile_id = {mid}")
        sql(f"UPDATE member_master_profile SET isdeleted = 1 WHERE pk_member_master_profile_id = {mid}")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

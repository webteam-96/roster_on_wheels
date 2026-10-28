"""Automatic anonymisation of terminated members by the district tenant's rule (build spec 3.14).

    python -I kb/tools/anonymise_retention_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Local copies only.
Picks a district where no real member would qualify under a 12-month rule, gives it that rule, adds three test members
(removed 14 and 2 months ago; one removed 14 months ago but active again) and runs POST /api/privacy/retention/run. Everything it adds is removed and the
district's rule restored at the end, except the test members and their memberships, which triggers only let it
soft-delete, and audit_log rows (append-only). The run also applies the
copy's ordinary log retention, as the daily job would.
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TAG = "e2e-retention-" + secrets.token_hex(3)
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
        with urllib.request.urlopen(req, timeout=120) as r:
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


sa = sign(int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")), "SuperAdmin")
# A district with a club and no membership that ended over 12 months ago, so only the test members can qualify.
district, club = [int(x) for x in sql("""SELECT d.pk_district_id, MIN(c.pk_club_id) FROM district_master d
    JOIN club_master c ON c.fk_district_id = d.pk_district_id AND c.isdeleted = 0
    WHERE d.isdeleted = 0 AND NOT EXISTS (SELECT 1 FROM club_members cm JOIN club_master c2 ON c2.pk_club_id = cm.fk_club_id
        WHERE c2.fk_district_id = d.pk_district_id AND cm.TerminationDate < CURDATE() - INTERVAL 12 MONTH)
    GROUP BY d.pk_district_id ORDER BY d.pk_district_id LIMIT 1""").split()]
had_row = sql(f"SELECT COUNT(*) FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0") == "1"
old_rule = sql(f"SELECT IFNULL(anonymise_after_months, 'NULL') FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0") if had_row else None
club_rows = sql(f"SELECT IFNULL(GROUP_CONCAT(pk_subscription_id), '0') FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id > 0")
ids = []
try:
    if not had_row:
        sql(f"""INSERT INTO tenant_subscriptions (fk_district_id, fk_club_id, edition_code)
                SELECT {district}, 0, code FROM edition_catalogue ORDER BY code LIMIT 1""")
    s, t = call("GET", f"/api/tenants/{district}", sa)
    sub = t.get("subscription") or {}
    s, b = call("PUT", f"/api/tenants/{district}", sa, {**sub, "anonymiseAfterMonths": 12})
    check("Super Admin sets the district's retention rule", s == 200, (s, b))
    s, t = call("GET", f"/api/tenants/{district}", sa)
    check("the rule is read back", (t.get("subscription") or {}).get("anonymiseAfterMonths") == 12, t.get("subscription"))
    s, b = call("PUT", f"/api/tenants/{district}", sa, {**sub, "anonymiseAfterMonths": 999})
    check("an out-of-range rule is refused", s == 400, (s, b))
    s, _ = call("POST", "/api/privacy/retention/run", sign(1, "Member"))
    check("only Super Admin runs retention", s == 403, s)

    for months, label in ((14, "old"), (2, "recent"), (14, "rejoined")):
        mid = int(sql(f"""INSERT INTO member_master_profile (MemberName, EmailId) VALUES ('{TAG} {label}', '{TAG}-{label}@example.invalid');
                          SELECT LAST_INSERT_ID();"""))
        ids.append(mid)
        # as ClubService.RemoveMemberAsync leaves it: soft-deleted with the termination stamped
        sql(f"""INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, IsActive, TerminationDate, isdeleted)
                VALUES ({club}, {mid}, 1, CURDATE() - INTERVAL {months} MONTH, 1)""")
    old, recent, rejoined = ids
    other = int(sql(f"SELECT pk_club_id FROM club_master WHERE isdeleted = 0 AND pk_club_id <> {club} LIMIT 1"))
    sql(f"INSERT INTO club_members (fk_club_id, fk_member_master_profile_id, IsActive, isdeleted) VALUES ({other}, {rejoined}, 1, 0)")
    att = int(sql(f"""INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, EventDateTime, created_by, created_date)
                      VALUES ({club}, 0, '{TAG} meeting', NOW() - INTERVAL 15 MONTH, 0, NOW()); SELECT LAST_INSERT_ID();"""))
    sql(f"INSERT INTO club_attendance_members (fk_attendance_id, fk_member_id) VALUES ({att}, {old})")

    s, b = call("POST", "/api/privacy/retention/run", sa)
    check("retention runs", s == 200, (s, b))
    check("it reports the anonymised member", any("terminated members anonymised: 1" in x for x in b.get("done", [])), b)
    name, email = sql(f"SELECT CONCAT(MemberName, '|', IFNULL(EmailId, '')) FROM member_master_profile WHERE pk_member_master_profile_id={old}").split("|")
    check("the member terminated 14 months ago is anonymised", TAG not in name and email == "", (name, email))
    check("their attendance stays for the totals", sql(f"SELECT COUNT(*) FROM club_attendance_members WHERE fk_attendance_id={att} AND fk_member_id={old}") == "1")
    check("the erasure is recorded as a system request",
          sql(f"SELECT COUNT(*) FROM privacy_requests WHERE fk_member_id={old} AND request_type='erase' AND status='completed' AND requested_by=0") == "1")
    check("the member terminated 2 months ago is kept",
          TAG in sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={recent}"))
    check("a member who left long ago but is active again is kept",
          TAG in sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={rejoined}"))
    s, b = call("POST", "/api/privacy/retention/run", sa)
    check("a second run anonymises nobody again", s == 200 and not any("terminated" in x for x in b.get("done", [])), b)
finally:
    if ids:
        idl = ",".join(map(str, ids))
        sql(f"DELETE FROM club_attendance_members WHERE fk_member_id IN ({idl})")
        sql(f"DELETE FROM club_attendance WHERE fk_club_id={club} AND EventName='{TAG} meeting'")
        sql(f"DELETE FROM privacy_requests WHERE fk_member_id IN ({idl})")
        # triggers refuse hard deletes of members and memberships: the test rows stay, soft-deleted
        sql(f"UPDATE club_members SET isdeleted = 1 WHERE fk_member_master_profile_id IN ({idl})")
        sql(f"UPDATE member_master_profile SET isdeleted = 1 WHERE pk_member_master_profile_id IN ({idl})")
    if had_row:
        sql(f"UPDATE tenant_subscriptions SET anonymise_after_months = {old_rule} WHERE fk_district_id={district} AND fk_club_id=0")
    else:
        sql(f"DELETE FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id=0")
    # club rows the PUT provisioned
    sql(f"DELETE FROM tenant_subscriptions WHERE fk_district_id={district} AND fk_club_id > 0 AND pk_subscription_id NOT IN ({club_rows})")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

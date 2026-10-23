"""Member edits and district-modules writes are scoped (2026-10-21).

    python -I kb/tools/member_scope_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). A club admin is picked
by query. Checks that he can edit a member of his club but not a member of another club, and that he cannot change
district citation settings. Nothing is written: the allowed edit sends an email address another active member already
uses, so it gets past the scope check and stops at the duplicate check (409) before saving; refused calls stop before
saving too. Local copies only, never production.
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
        with urllib.request.urlopen(req, timeout=60) as r:
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


ACTIVE = "cm.IsActive=1 AND cm.isdeleted=0"
mid, club = [int(x) for x in sql("SELECT fk_member_master_profile_id, fk_club_id FROM member_roles WHERE fk_role_id=2 AND IsActive=1 "
                                  "AND isdeleted=0 AND fk_club_id>0 ORDER BY 1 LIMIT 1").split()]
district = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}"))
own = int(sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND {ACTIVE} "
              f"AND cm.fk_member_master_profile_id<>{mid} LIMIT 1"))
other = int(sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE {ACTIVE} AND cm.fk_member_master_profile_id<>{mid} "
                f"AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id={club} "
                "AND IsActive=1 AND isdeleted=0) LIMIT 1"))
# an email another active member already uses: the duplicate check refuses it after the scope check, before any save
taken = sql(f"SELECT m.EmailId FROM member_master_profile m JOIN club_members cm ON cm.fk_member_master_profile_id=m.pk_member_master_profile_id "
            f"AND {ACTIVE} WHERE m.isdeleted=0 AND m.EmailId LIKE '%@%' AND m.pk_member_master_profile_id NOT IN ({own}, {mid}) "
            f"AND LOWER(m.EmailId) <> (SELECT LOWER(IFNULL(EmailId,'')) FROM member_master_profile WHERE pk_member_master_profile_id={own}) LIMIT 1")
admin = sign(mid, "Admin")

s, m = call("GET", f"/api/members/{own}", token=admin)
check("a club admin reads a member of their club", s == 200, (s, m))
s, b = call("PUT", f"/api/members/{own}", {**m, "emailId": taken}, admin)
check("a club admin edits a member of their club (refused only as a duplicate email)", s == 409, (s, b))
s, b = call("PUT", f"/api/members/{other}", m, admin)
check("a club admin cannot edit a member of another club", s == 403, (s, b))
s, b = call("POST", f"/api/district-modules/{district}/citation/categories", {"categoryName": "e2e"}, admin)
check("a club admin cannot change district citation settings", s == 403, (s, b))

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

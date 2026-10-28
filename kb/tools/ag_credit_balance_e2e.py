"""An Assistant Governor can read the credit balance of a club assigned to them, and no other club's.

    python -I kb/tools/ag_credit_balance_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Read-only: picks an
active district_ag assignment by query and writes nothing. Local copies only, never production.
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


def get(path, token):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


# An AG who is not also a club or district admin, so only the new rule can let them in.
row = sql("""SELECT da.fk_member_id, da.fk_club_id FROM district_ag da
             JOIN club_master c ON c.pk_club_id = da.fk_club_id AND c.isdeleted = 0
             WHERE da.isdeleted = 0 AND da.is_active = 1
               AND NOT EXISTS (SELECT 1 FROM member_roles mr WHERE mr.fk_member_master_profile_id = da.fk_member_id
                               AND mr.fk_role_id IN (2, 3) AND mr.IsActive = 1 AND mr.isdeleted = 0)
             LIMIT 1""")
if not row:
    sys.exit("no active AG assignment without an admin role in this database")
ag, club = [int(x) for x in row.split()]
other = int(sql(f"""SELECT pk_club_id FROM club_master WHERE isdeleted = 0 AND pk_club_id NOT IN
                    (SELECT fk_club_id FROM district_ag WHERE fk_member_id = {ag} AND isdeleted = 0) LIMIT 1"""))
token = sign(ag, "Member,AssistantGovernor")

s, b = get(f"/api/credit-management/club/{club}/balance", token)
check("AG reads the balance of an assigned club", s == 200 and "emailRemaining" in json.dumps(b), (s, b))
s, _ = get(f"/api/credit-management/club/{other}/balance", token)
check("AG is refused another club's balance", s == 403, s)
s, _ = get(f"/api/credit-management/club/{club}/balance", sign(0, "Member"))
check("no member id is refused", s == 403, s)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

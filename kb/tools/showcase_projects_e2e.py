"""The ROW Showcase extension's project list (build spec 3.12): GET /api/clubs/{clubId}/showcase/projects.

    python -I kb/tools/showcase_projects_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Read-only. Local copies
only. The extension's own logic is tested by `node --test row/showcase-extension/mapping.test.mjs`.
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


def get(path, token=None):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"[]")
    except urllib.error.HTTPError as e:
        return e.code, None


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


admin, club = [int(x) for x in sql("""SELECT mr.fk_member_master_profile_id, mr.fk_club_id FROM member_roles mr
    JOIN club_master c ON c.pk_club_id = mr.fk_club_id AND c.isdeleted = 0
    WHERE mr.fk_role_id = 2 AND mr.fk_club_id > 0 AND mr.IsActive = 1 AND mr.isdeleted = 0 LIMIT 1""").split()]
plain = int(sql(f"""SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id = {club}
    AND cm.IsActive = 1 AND cm.isdeleted = 0 AND NOT EXISTS (SELECT 1 FROM member_roles r
    WHERE r.fk_member_master_profile_id = cm.fk_member_master_profile_id AND r.fk_role_id IN (2, 3) AND r.IsActive = 1 AND r.isdeleted = 0)
    LIMIT 1""") or 0)
path = f"/api/clubs/{club}/showcase/projects"
s, rows = get(path, sign(admin, "Admin"))
check("the club admin gets the club's service projects, website or not", s == 200 and isinstance(rows, list), (s, rows))
if rows:
    check("each project has what the extension shows and fetches", all({"id", "yearId", "title", "yearLabel"} <= set(r) for r in rows), rows[0])
s, _ = get(path)
check("signed out is refused", s == 401, s)
if plain:
    s, _ = get(path, sign(plain, "Member"))
    check("a plain member is refused", s == 403, s)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

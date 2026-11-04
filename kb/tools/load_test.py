"""Load test of the slow read screens: real routes, many users at once, response times per route.

    python -I kb/tools/load_test.py <api_base> <mysql_port> <database> [users=25] [requests_per_route=100]

JWT secret from ROW_E2E_JWT_SECRET. Local copies only, never production. Read only. Rate limits answer 429 by design:
they are counted apart from errors. Exit code 1 when a route errors or its p95 is over 2 seconds.
"""
import base64, concurrent.futures as cf, hashlib, hmac, json, os, statistics, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
USERS = int(sys.argv[4]) if len(sys.argv) > 4 else 25
COUNT = int(sys.argv[5]) if len(sys.argv) > 5 else 100
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
P95_LIMIT_MS = 2000


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q], capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


member = sql("SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN roles r ON r.pk_role_id=mr.fk_role_id WHERE r.RoleName='SuperAdmin' AND mr.IsActive=1 AND mr.isdeleted=0 LIMIT 1")
body = {"memberId": member, "name": "load", "email": "load@example.org", "roles": "SuperAdmin", "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 7200}
signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
TOKEN = f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"
# The busiest club and district, so the numbers are the worst real case.
club = sql("SELECT fk_club_id FROM club_members WHERE isdeleted=0 GROUP BY fk_club_id ORDER BY COUNT(*) DESC LIMIT 1")
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={club}")
ROUTES = [
    "/api/public/brand",
    "/api/clubs?page=1&pageSize=25",
    "/api/clubs?page=1&pageSize=25&search=Rotary",
    "/api/districts?page=1&pageSize=25",
    "/api/members?page=1&pageSize=25",
    "/api/members?page=1&pageSize=25&search=John",
    f"/api/club-admin-dashboard/overview?clubId={club}",
    f"/api/club-admin-dashboard/membership?clubId={club}",
    f"/api/club-admin-dashboard/foundation?clubId={club}",
    f"/api/district-admin-dashboard/overview?districtId={district}",
    f"/api/district-admin-dashboard/membership?districtId={district}",
    f"/api/district-admin-dashboard/foundation?districtId={district}",
    f"/api/district-admin-dashboard/members?districtId={district}&page=1&pageSize=25",
    f"/api/district-admin-dashboard/egovernance?districtId={district}",
    f"/api/district-admin-dashboard/egovernance/per-club?districtId={district}",
    f"/api/district-performance-report/view?districtId={district}",
    "/api/Admin/audit-log?page=1&pageSize=25",
    "/api/Admin/members-with-roles",
    "/api/mobile/club-finder?search=Rotary",
]
# Run by one SuperAdmin at a time or a daily job, so they are timed alone: three in a row, not 25 at once.
SOLO = ["/api/daily-stats-report/preview?format=counts"]


def hit(path):
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {TOKEN}"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:
        code = 0
    return code, (time.perf_counter() - t0) * 1000


fails = 0
print(f"{USERS} users at once, {COUNT} requests a route, club {club}, district {district}\n")
print(f"{'p50':>8}{'p95':>8}{'max':>8} {'ok':>4}{'429':>5}{'err':>5}  route")
results = []
for path in ROUTES:
    with cf.ThreadPoolExecutor(USERS) as pool:
        got = list(pool.map(hit, [path] * COUNT))
    times = sorted(t for c, t in got if c == 200)
    ok, limited = len(times), sum(c == 429 for c, _ in got)
    err = COUNT - ok - limited
    codes = sorted({c for c, _ in got if c not in (200, 429)})
    p50 = statistics.median(times) if times else 0
    p95 = times[max(0, int(len(times) * .95) - 1)] if times else 0
    top = times[-1] if times else 0
    bad = err > 0 or p95 > P95_LIMIT_MS
    fails += bad
    print(f"{p50:8.0f}{p95:8.0f}{top:8.0f} {ok:4d}{limited:5d}{err:5d}  {path}{'  ' + str(codes) if codes else ''}{'  <-- SLOW' if p95 > P95_LIMIT_MS else ''}")
print("\nOne at a time:")
for path in SOLO:
    got = [hit(path) for _ in range(3)]
    print(f"{max(t for _, t in got):8.0f} ms worst of 3, codes {sorted({c for c, _ in got})}  {path}")
    fails += any(c != 200 for c, _ in got)
print("\nALL PASS" if not fails else f"\n{fails} routes over the limit or erroring")
sys.exit(1 if fails else 0)

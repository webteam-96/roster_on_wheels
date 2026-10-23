"""Platform module switches (api/Services/FeatureGate.cs, user's module sheet 2026-10-21).

    python kb/tools/feature_gate_e2e.py [api_base] [mysql_port]
Dev database only. Needs no login: the gate runs before sign-in checks, so a switched-off module answers 404 and an
open one answers 401 to an anonymous call. Turns 'ocv' on in platform_features for a moment and back off.
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
PORT = sys.argv[2] if len(sys.argv) > 2 else "3317"
DB = sys.argv[3] if len(sys.argv) > 3 else "row_local"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def call(method, path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers={"Content-Type": "application/json"})
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


def gated(method, path, key):
    s, b = call(method, path, {} if method != "GET" else None)
    return s == 404 and b.get("feature") == key, (s, b)


def open_(method, path):
    s, b = call(method, path, {} if method != "GET" else None)
    return s != 404 or "feature" not in b, (s, b)


was = sql("SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key='ocv'")
try:
    for name, method, path, key in [
        ("OCV is off by default", "GET", "/api/clubs/1/ocv-gov", "ocv"),
        ("club monthly report is off by default", "GET", "/api/clubs/1/monthly-reports", "club_monthly_report"),
        ("sub groups are off by default", "GET", "/api/clubs/1/sub-groups/available-years", "sub_groups"),
    ]:
        ok, d = gated(method, path, key)
        check(name, ok, d)

    # removed modules (2026-10-23) have no route and no switch: a plain 404, not the gate's
    gone = {p: call("GET", p) for p in ["/api/clubs/1/pph-camps", "/api/ri-director/context", "/api/zonal-dashboard",
                                        "/api/project-approval/moderator/projects",
                                        "/api/system-settings/direct_beneficiaries_limit"]}
    check("removed modules' routes are gone", all(s == 404 and "feature" not in b for s, b in gone.values()), gone)

    for name, method, path in [
        ("district committee sub groups stay open", "GET", "/api/districts/1/committee/groups/1/sub-groups"),
        ("goal setting stays open", "GET", "/api/goal-setting/categories"),
        ("other club pages stay open", "GET", "/api/clubs/1/attendance"),
        ("mass email's member list stays open while sub groups are off", "GET", "/api/clubs/1/sub-groups/club-members"),
    ]:
        ok, d = open_(method, path)
        check(name, ok, d)

    s, b = call("GET", "/api/features")
    check("reading the switches needs sign-in", s == 401, (s, b))
    s, b = call("PUT", "/api/features/ocv", {"enabled": True})
    check("changing a switch needs sign-in", s == 401, (s, b))

    sql("INSERT INTO platform_features (feature_key, enabled) VALUES ('ocv', 1) ON DUPLICATE KEY UPDATE enabled = 1")
    time.sleep(31)  # the API caches the switches for 30 seconds
    ok, d = open_("GET", "/api/clubs/1/ocv-gov")
    check("OCV opens once switched on", ok, d)
finally:
    sql(f"INSERT INTO platform_features (feature_key, enabled) VALUES ('ocv', {was}) ON DUPLICATE KEY UPDATE enabled = {was}")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

"""Meeting mode and link on attendance records (ROW Wave 1, task 2).

    python -I kb/tools/meeting_mode_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret); the SuperAdmin is
picked by query. Local copies only, never production. Creates one attendance record on the first club, deletes it
through the API and then removes the soft-deleted row.
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


token = sign(int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")), "SuperAdmin")
club, other = [int(x) for x in sql("SELECT pk_club_id FROM club_master WHERE isdeleted=0 ORDER BY 1 LIMIT 2").split()]
base = f"/api/clubs/{club}/attendance"
meeting = {"eventName": "e2e hybrid meeting", "description": "", "eventDateTime": "2026-10-21T18:00:00",
           "meetingMode": "hybrid", "meetingLink": "https://zoom.us/j/123456789", "memberIds": []}

s, b = call("POST", base, meeting, token)
mid = b.get("id")
try:
    check("hybrid meeting with an https link is saved", s == 200 and mid, (s, b))
    s, d = call("GET", f"{base}/{mid}", token=token)
    check("mode and link are read back", d.get("meetingMode") == "hybrid" and d.get("meetingLink") == meeting["meetingLink"], d)
    # wall-clock storage (a non-UTC server or time.emitOffset off): the typed time is kept as is
    stored = sql(f"SELECT DATE_FORMAT(EventDateTime, '%Y-%m-%dT%H:%i:%s') FROM club_attendance WHERE pk_attendance_id={int(mid)}")
    check("a time without an offset is stored as the club's wall-clock", stored == meeting["eventDateTime"], stored)
    s, lst = call("GET", f"{base}?yearId=0", token=token)
    row = next((i for i in lst.get("items", []) if i.get("id") == mid), {})
    check("the list carries the mode", row.get("meetingMode") == "hybrid", row)

    s, b = call("PUT", f"{base}/{mid}", {**meeting, "meetingLink": "javascript:alert(1)"}, token)
    check("a non-https link is refused", s == 400, (s, b))
    s, b = call("PUT", f"{base}/{mid}", {**meeting, "meetingMode": "teleport"}, token)
    check("an unknown mode is refused", s == 400, (s, b))
    s, b = call("PUT", f"{base}/{mid}", {**meeting, "meetingMode": "in_person"}, token)
    d = call("GET", f"{base}/{mid}", token=token)[1]
    check("in person keeps no link", s == 200 and d.get("meetingMode") == "in_person" and not d.get("meetingLink"), (s, d))

    s, b = call("PUT", f"/api/clubs/{other}/attendance/{mid}", meeting, token)
    check("a record cannot be edited through another club's URL", s == 404, (s, b))
    s, b = call("DELETE", f"/api/clubs/{other}/attendance/{mid}", token=token)
    check("a record cannot be deleted through another club's URL", s == 404, (s, b))

    s, b = call("DELETE", f"{base}/{mid}", token=token)
    check("cleanup delete", s == 200, (s, b))
finally:
    if mid:  # the API only soft-deletes; the test row goes for good
        sql(f"DELETE FROM club_attendance WHERE pk_attendance_id={int(mid)} AND fk_club_id={club} AND EventName='e2e hybrid meeting'")
print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

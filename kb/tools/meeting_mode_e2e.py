"""Meeting mode and link on attendance records (ROW Wave 1, task 2).

    python kb/tools/meeting_mode_e2e.py [api_base] [mysql_port]
Creates and deletes one attendance record on the first Monrovia demo club (dev database only).
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
PORT = sys.argv[2] if len(sys.argv) > 2 else "3317"
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", "row_local", "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


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


token = call("POST", "/api/auth/login", {"email": "naren@kaizeninfotech.com", "password": "Admin@123"})[1].get("token", "")
club, other = [int(x) for x in sql("SELECT pk_club_id FROM club_master WHERE isdeleted=0 ORDER BY 1 LIMIT 2").split()]
base = f"/api/clubs/{club}/attendance"
meeting = {"eventName": "e2e hybrid meeting", "description": "", "eventDateTime": "2026-10-21T18:00:00",
           "meetingMode": "hybrid", "meetingLink": "https://zoom.us/j/123456789", "memberIds": []}

s, b = call("POST", base, meeting, token)
mid = b.get("id")
check("hybrid meeting with an https link is saved", s == 200 and mid, (s, b))
s, d = call("GET", f"{base}/{mid}", token=token)
check("mode and link are read back", d.get("meetingMode") == "hybrid" and d.get("meetingLink") == meeting["meetingLink"], d)
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
print(f"\n{fails} failed")
sys.exit(1 if fails else 0)

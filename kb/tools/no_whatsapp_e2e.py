"""ROW has no WhatsApp (2026-10-19): the API refuses every WhatsApp send, credit grant, purchase and OTP path.

    python kb/tools/no_whatsapp_e2e.py [api_base]
Read-only against the dev database: every request here is expected to be refused before it writes.
"""
import json
import sys
import urllib.error
import urllib.request

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5000"
fails = 0


def call(method, path, body=None, token=None, form=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    data = None
    if form is not None:  # multipart: the credit endpoints also take an optional proof file
        boundary = "rowe2eboundary"
        data = "".join(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n"
                       for k, v in form.items()).encode() + f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
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


sa = call("POST", "/api/auth/login", {"email": "naren@kaizeninfotech.com", "password": "Admin@123"})[1].get("token", "")
check("super admin signs in", bool(sa))

for path in ["/api/mobile/auth/request-otp", "/api/mobile/auth/verify-otp"]:
    s, _ = call("POST", path, {})
    check(f"{path} is gone (404)", s == 404, s)

for path in ["/api/whatsapp-log", "/api/whatsapp-info/club/1"]:
    s, _ = call("GET", path, token=sa)
    check(f"{path} is gone (404)", s == 404, s)

grant = {"FkDistrictId": "1", "FkClubId": "1", "CreditType": "WhatsApp", "CreditCount": "10",
         "FromDate": "2026-10-19", "ToDate": "2027-10-19"}
s, b = call("POST", "/api/credit-management", token=sa, form=grant)
check("offline WhatsApp credit grant refused (400)", s == 400, (s, b))

s, b = call("POST", "/api/ri-director/credits", token=sa, form={**grant, "CreditType": "WhatsApp"})
check("RI Director WhatsApp credit grant refused (400)", s == 400, (s, b))

s, b = call("POST", "/api/admin/directory-config/1/send-reminders?channel=whatsapp", token=sa)
check("directory WhatsApp reminders refused (400)", s == 400, (s, b))
s, b = call("POST", "/api/admin/directory-config/1/send-reminders?channel=both", token=sa)
check("directory 'both' channel refused (400)", s == 400, (s, b))

s, b = call("GET", "/api/admin/wallet/districts", token=sa)
text = json.dumps(b).lower()
check("district wallet lists no WhatsApp balance or pay link", s == 200 and "whatsapp" not in text, (s, text[:200]))

s, b = call("GET", "/api/recipient-info/club/1", token=sa)
check("email recipient estimate still served", s == 200 and "emailRecipientCount" in b and "whatsAppRemaining" not in b, (s, b))

print(f"{fails} failed")
sys.exit(1 if fails else 0)

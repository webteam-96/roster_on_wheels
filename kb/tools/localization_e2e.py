"""Localization service: memory, protected terms, what is never sent, placeholders, limits, corrections, failures.

    python -I kb/tools/localization_e2e.py <api_base> <mysql_port> <database>

JWT secret from ROW_E2E_JWT_SECRET. Run the API with Translation__Provider=libretranslate and
Translation__ApiUrl=http://127.0.0.1:5199 (this script answers there as a fake provider, nothing leaves the machine)
and Translation__VisitorDailyChars=200. Local copies only: it empties the translation tables at the start and end.
"""
import base64, hashlib, hmac, json, os, subprocess, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0
received = []
mode = {"value": "ok"}


class Fake(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        q = body["q"]
        received.append(q)
        if mode["value"] == "down":
            self.send_response(500); self.end_headers(); return
        if body.get("target") == "ta":  # a language the server has no model for
            self.send_response(400); self.end_headers(); return
        out = "FR " + q
        if "Lose" in q:
            out = "FR perdu"  # a provider dropping the protected value
        raw = json.dumps({"translatedText": out}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(raw)

    def log_message(self, *a):
        pass


threading.Thread(target=HTTPServer(("127.0.0.1", 5199), Fake).serve_forever, daemon=True).start()


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "--default-character-set=utf8mb4", "-e", q],
                          capture_output=True, text=True, check=True, encoding="utf-8").stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        fails += 1


def wipe():
    sql("DELETE FROM translation_memory; DELETE FROM translation_usage; DELETE FROM translation_memory_version")


sa = sql("SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN roles r ON r.pk_role_id=mr.fk_role_id "
         "WHERE r.RoleName='SuperAdmin' AND mr.IsActive=1 AND mr.isdeleted=0 LIMIT 1")
SA = token(sa, "SuperAdmin")
MEMBER = token(sql(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id<>{sa} LIMIT 1"), "Member")


def tr(texts, tok=SA, target="fr"):
    st, r = call("POST", "/api/i18n/translate", tok, {"target": target, "source": "en", "q": texts})
    assert st == 200, (st, r)
    return r["translations"]


wipe()
time.sleep(35)  # any pause from before this fake provider was listening has passed
received.clear()
wipe()
try:
    # Provider and memory
    check("translates through the provider", tr(["Members"]) == ["FR Members"])
    n = len(received)
    check("second ask comes from memory, no provider call", tr(["Members"]) == ["FR Members"] and len(received) == n)
    st, r = call("POST", "/api/i18n/translate", MEMBER, {"target": "fr", "source": "en", "q": ["Members"]})
    check("an ordinary signed-in member can translate", st == 200 and r["translations"] == ["FR Members"], f"{st} {r}")
    check("memory row stored", sql("SELECT translated_text, provider, is_override FROM translation_memory WHERE source_text='Members'") == "FR Members\tlibretranslate\t0")
    check("usage counted", int(sql("SELECT SUM(chars_sent) FROM translation_usage")) >= 7)
    check("English target sends nothing", tr(["Hello there"], target="en") == ["Hello there"] and len(received) == n)
    st, r = call("POST", "/api/i18n/translate", SA, {"target": "../../x", "q": ["Hello"]})
    check("bad language echoes the text", st == 200 and r["translations"] == ["Hello"])

    # Protected terms and values
    out = tr(["Welcome to Roster On Wheels, {name}"])[0]
    sent = received[-1]
    check("product name and placeholder never reach the provider", "Roster" not in sent and "{name}" not in sent and "XQ0X" in sent, sent)
    check("they come back unchanged", out == "FR Welcome to Roster On Wheels, {name}", out)
    out = tr(["Rotary and Rotaract clubs"])[0]
    check("Rotary terms kept", out == "FR Rotary and Rotaract clubs" and "Rotary" not in received[-1], f"{out} / {received[-1]}")
    tr(["Rowing clubs row"])
    check("ROW only as a whole word in capitals", "Rowing clubs row" in received[-1], received[-1])
    tr(["Write to help@example.org or https://example.org/a today"])
    sent = received[-1]
    check("email and link in a sentence are hidden", "example.org" not in sent, sent)
    n = len(received)
    same = ["help@example.org", "https://example.org", "12345", "+1 555 0100", "ROW", "{name}", ""]
    check("nothing but values: not sent, unchanged", tr(same) == same and len(received) == n, str(received[n:]))
    long_text = "word " * 1100
    check("over-long text stays English", tr([long_text]) == [long_text] and len(received) == n)

    # A provider that breaks a value
    out = tr(["Lose {name} now"])[0]
    check("changed value keeps the English", out == "Lose {name} now", out)
    check("and is not stored", sql("SELECT COUNT(*) FROM translation_memory WHERE source_text='Lose {name} now'") == "0")

    # Order and duplicates
    n = len(received)
    check("order kept, duplicates sent once", tr(["Beta", "Alpha", "Beta"]) == ["FR Beta", "FR Alpha", "FR Beta"] and len(received) == n + 2)

    # Limits
    sql("UPDATE translation_usage SET chars_sent = 450000")
    n = len(received)
    check("monthly limit: new text stays English", tr(["Over the limit"]) == ["Over the limit"] and len(received) == n)
    check("monthly limit: memory still answers", tr(["Members"]) == ["FR Members"])
    sql("UPDATE translation_usage SET chars_sent = 0")
    r1 = tr(["Visitor text one is quite a long sentence for the budget " * 2], tok=None)
    r2 = tr(["Visitor text two is also quite a long sentence for it " * 4], tok=None)
    check("visitor share: first new text translated", r1[0].startswith("FR "), r1[0][:40])
    check("visitor share: past the daily share stays English", not r2[0].startswith("FR "), r2[0][:40])
    check("visitor: cached text is free", tr(["Members"], tok=None) == ["FR Members"])
    st, r = call("POST", "/api/i18n/translate", None, {"target": "fr", "q": [f"x{i}" for i in range(400)]})
    check("visitor: batch cut to 300", st == 200 and len(r["translations"]) == 300)

    # Corrections
    st, v0 = call("GET", "/api/i18n/memory/version")
    check("version readable without sign-in", st == 200)
    st, _ = call("PUT", "/api/i18n/memory", MEMBER, {"locale": "fr", "source": "Members", "text": "Hack"})
    check("member cannot correct", st == 403, str(st))
    st, _ = call("GET", "/api/i18n/memory?locale=fr", MEMBER)
    check("member cannot read the memory", st == 403, str(st))
    st, _ = call("GET", "/api/i18n/memory?locale=fr")
    check("sign-in required", st == 401, str(st))
    st, r = call("PUT", "/api/i18n/memory", SA, {"locale": "fr", "source": "Hello {name}", "text": "Bonjour"})
    check("correction must keep the placeholder", st == 400, str(r))
    st, _ = call("PUT", "/api/i18n/memory", SA, {"locale": "fr", "source": "Members", "text": "Membres"})
    check("correction saved", st == 204, str(st))
    n = len(received)
    check("correction wins at once", tr(["Members"]) == ["Membres"] and len(received) == n)
    st, v1 = call("GET", "/api/i18n/memory/version")
    check("version changed", v1["version"] != v0["version"])
    st, page = call("GET", "/api/i18n/memory?locale=fr&correctionsOnly=true", SA)
    check("listed as a correction", st == 200 and page["total"] == 1 and page["rows"][0]["isOverride"] is True and page["provider"] == "libretranslate", str(page)[:200])
    st, srch = call("GET", "/api/i18n/memory?locale=fr&search=Alpha", SA)
    check("search", st == 200 and srch["total"] == 1)
    st, _ = call("GET", "/api/i18n/memory?locale=fr&search=%25%27%20OR%201%3D1%20--%20", SA)
    check("search input is parameterized", st == 200)
    h = page["rows"][0]["hash"]
    st, _ = call("DELETE", f"/api/i18n/memory/fr/{h}", SA)
    check("removed", st == 204, str(st))
    check("goes back to the machine", tr(["Members"]) == ["FR Members"])
    st, _ = call("DELETE", f"/api/i18n/memory/fr/{'0' * 64}", SA)
    check("unknown row 404", st == 404)

    # A language the provider does not have
    check("language with no model stays English", tr(["No model text"], target="ta") == ["No model text"])
    check("and other languages keep working", tr(["Right after no model"]) == ["FR Right after no model"])

    # Provider failure
    mode["value"] = "down"
    check("provider down: English, no error", tr(["Provider is down"]) == ["Provider is down"])
    n = len(received)
    check("then it pauses instead of hammering", tr(["Still down now"]) == ["Still down now"] and len(received) == n)
    check("not stored", sql("SELECT COUNT(*) FROM translation_memory WHERE source_text='Provider is down'") == "0")
    mode["value"] = "ok"
finally:
    wipe()

print(f"\n{'ALL PASS' if fails == 0 else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)

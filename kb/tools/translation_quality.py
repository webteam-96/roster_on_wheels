"""Real ROW text through the API's translation service: does every language come back, and do protected values survive?

    python -I kb/tools/translation_quality.py <api_base> <mysql_port> <database> [out.tsv]

JWT secret from ROW_E2E_JWT_SECRET. Run the API with Translation__Provider=libretranslate and Translation__ApiUrl set.
Local copies only. Stored translations from this run stay in translation_memory, as normal use would leave them.
"""
import base64, hashlib, hmac, json, os, re, subprocess, sys, time, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
OUT = sys.argv[4] if len(sys.argv) > 4 else None
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
LANGS = ["fr", "de", "it", "ja", "ko", "pt", "es"]
TEXTS = [
    "Members", "Club dues", "Attendance", "Sign in", "Forgot password?", "Save", "Cancel", "Dashboard",
    "District", "Board of Directors", "Past presidents", "Membership dues", "Total payable", "Bank code",
    "Your payment has been received.", "This club has no dues to pay.", "No translations yet for this language.",
    "Are you sure you want to delete this member?", "Credits are valid for 1 year from purchase.",
    "Welcome to Roster On Wheels, {name}", "Rotary and Rotaract clubs", "Paul Harris Fellow",
    "The Rotary Foundation supports {count} projects", "Write to help@example.org for support",
    "Visit https://example.org/help today", "Hello {name}, your club {clubName} has {count} new members",
    "Rotary International", "Area of Focus", "Service projects in your district", "Meeting starts at {time}",
]
PROTECTED = re.compile(r"\{\w+\}|[\w.]+@[\w.]+\w|https?://\S+|Roster On Wheels|Rotary International|Rotary Foundation|Paul Harris Fellow|Rotaract|Rotary")


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q], capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


member = sql("SELECT mr.fk_member_master_profile_id FROM member_roles mr JOIN roles r ON r.pk_role_id=mr.fk_role_id WHERE r.RoleName='SuperAdmin' AND mr.IsActive=1 AND mr.isdeleted=0 LIMIT 1")
body = {"memberId": member, "name": "qa", "email": "qa@example.org", "roles": "SuperAdmin", "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 3600}
signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
TOKEN = f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def translate(target, texts):
    req = urllib.request.Request(API + "/api/i18n/translate", data=json.dumps({"target": target, "source": "en", "q": texts}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())["translations"]


fails = 0
rows = []
for lang in LANGS:
    t0 = time.time()
    out = translate(lang, TEXTS)
    first = time.time() - t0
    t0 = time.time()
    translate(lang, TEXTS)
    second = time.time() - t0
    lost = [s for s, o in zip(TEXTS, out) if any(v not in o for v in PROTECTED.findall(s))]
    # Text made only of protected values stays the same on purpose.
    same = [s for s, o in zip(TEXTS, out) if s == o and PROTECTED.sub("", s).strip(" ,.")]
    print(f"{lang}: first {first:5.1f}s, from memory {second:5.2f}s, unchanged {len(same)}/{len(TEXTS)}, protected value lost {len(lost)}")
    if same:
        print("    unchanged:", same)
    if lost:
        print("    lost:", lost)
        fails += 1
    rows.extend((lang, s, o) for s, o in zip(TEXTS, out))
if OUT:
    with open(OUT, "w", encoding="utf-8") as f:
        for r in rows:
            f.write("\t".join(r) + "\n")
print("ALL PASS" if not fails else f"{fails} languages lost a protected value")
sys.exit(1 if fails else 0)

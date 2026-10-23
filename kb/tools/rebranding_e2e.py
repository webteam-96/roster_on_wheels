"""Rebranding (2026-10-24): the API's public brand, the emails and the share card it renders carry the ROW brand.

    python -I kb/tools/rebranding_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret, and with a dummy
email endpoint so nothing leaves the machine). Sends the district dues TEST reminder and receipt (sample values, no
wallet credit) to a reserved example.invalid address as an existing SuperAdmin and reads the body the API logged in
email_log; draws the public share card of a temporary project in the current year's table. Deletes the email_log
rows, the project row and its cached card afterwards. Local copies only, never production.
"""
import base64, hashlib, hmac, json, os, struct, subprocess, sys, time, urllib.error, urllib.request, uuid, zlib
from pathlib import Path

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TO = "row-brand-e2e@example.invalid"
CARD_TITLE = "ROW brand e2e card"
AZURE, OLD_NAVY = (0x17, 0x45, 0x8F), (0x0B, 0x2C, 0x5E)  # ROW azure; the share card's former navy
# The API in this checkout writes card caches under row/api/wwwroot (gitignored); removed after the check.
CARD_CACHE = Path(__file__).resolve().parents[2] / "row" / "api" / "wwwroot" / "Documents" / "share-cache"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 600}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def request(method, path, tok=None, form=None, raw=False):
    headers, data = {}, None
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    if form is not None:
        boundary = uuid.uuid4().hex
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in form.items()]
        data = ("".join(parts) + f"--{boundary}--\r\n").encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return r.status, body if raw else json.loads(body or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, b"" if raw else {}


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def logged(kind):
    """Facts about the newest logged body for the e2e address whose subject names the kind."""
    row = sql("SELECT INSTR(body_html, UNHEX('E282B9')) > 0, "            # the rupee sign, UTF-8 bytes
              "INSTR(body_html, '#17458F') > 0, "                        # ROW azure (pay button / heading)
              "INSTR(LOWER(body_html), '#1a365d') + INSTR(LOWER(body_html), '#3182ce') > 0, "  # the old palette
              "body_html "
              f"FROM email_log WHERE recipient_email='{TO}' AND subject LIKE '%{kind}%' ORDER BY pk_id DESC LIMIT 1")
    if not row:
        return None
    rupee, azure, old, body = row.split("\t", 3)
    return {"rupee": rupee == "1", "azure": azure == "1", "old": old == "1", "body": body}


def png_pixels(data):
    """RGB tuples of an 8-bit RGB/RGBA, non-interlaced PNG (what the card builder writes); stdlib only."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat = 8, b""
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            assert depth == 8 and ctype in (2, 6) and interlace == 0, (depth, ctype, interlace)
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    bpp = 3 if ctype == 2 else 4
    stride, raw, prev, out = width * bpp, zlib.decompress(idat), bytearray(width * bpp), []
    for y in range(height):
        f, line = raw[y * (stride + 1)], bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b, c = prev[i], prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out.extend(tuple(line[x:x + 3]) for x in range(0, stride, bpp))
        prev = line
    return out


sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 LIMIT 1"))
plain = int(sql("SELECT pk_member_master_profile_id FROM member_master_profile WHERE pk_member_master_profile_id NOT IN "
                "(SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id<>1 AND IsActive=1) LIMIT 1"))
district = int(sql("SELECT pk_district_id FROM district_master ORDER BY pk_district_id LIMIT 1"))
year_id, year_label = sql("SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE IsCurrent=1 LIMIT 1").split("\t")
projects = f"rotary_projects_{year_label.replace('-', '_')}"
# A club whose club -> district -> zone chain is active, as the public share filter requires.
club = sql("SELECT c.pk_club_id FROM club_master c "
           "JOIN district_master d ON d.pk_district_id=c.fk_district_id AND d.isdeleted=0 AND d.IsActive=1 "
           "JOIN zone_master z ON z.pk_zone_id=d.fk_zone_id AND z.isdeleted=0 AND z.IsActive=1 "
           "WHERE c.isdeleted=0 AND c.IsActive=1 ORDER BY c.pk_club_id LIMIT 1")
module = sql("SELECT pk_module_id FROM module_master ORDER BY pk_module_id LIMIT 1")
check("no earlier e2e rows",
      sql(f"SELECT COUNT(*) FROM email_log WHERE recipient_email='{TO}'") == "0"
      and sql(f"SELECT COUNT(*) FROM `{projects}` WHERE title='{CARD_TITLE}'") == "0")
project = None

try:
    s, brand = request("GET", "/api/public/brand")
    check("public brand is ROW", s == 200 and brand.get("productName") == "Roster On Wheels"
          and brand.get("shortName") == "ROW", (s, brand.get("productName")))
    loc = brand.get("locale", {})
    # Brand.Money(1800) for the sample: 18 unpaid members x 100. ROW's own locale prints "$1,800.00".
    amount = "$1,800.00" if (loc.get("defaultCurrency"), loc.get("numberLocale")) == ("USD", "en-US") else "1,800"

    tok = token(sa, ["SuperAdmin"])
    s, _ = request("POST", "/api/club-dues/test-email", form={"Email": "not-an-address", "Type": "reminder",
                                                              "DistrictId": district, "DuesId": 0})
    check("test email needs sign-in", s == 401, s)
    s, _ = request("POST", "/api/club-dues/test-email", token(plain, ["Member"]),
                   form={"Email": TO, "Type": "reminder", "DistrictId": district, "DuesId": 0})
    check("a member without an admin role is refused", s == 403, s)

    for kind in ("reminder", "receipt"):
        s, _ = request("POST", "/api/club-dues/test-email", tok,
                       form={"Email": TO, "Type": kind, "DistrictId": district, "DuesId": 0})
        check(f"SuperAdmin sends the {kind} test", s == 200, s)
        facts = logged(kind)
        check(f"{kind}: body logged", facts is not None)
        if facts:
            check(f"{kind}: amount in the brand currency ({amount})", amount in facts["body"], facts["body"][:300])
            check(f"{kind}: no rupee sign", not facts["rupee"])
            check(f"{kind}: no colour of the original platform", not facts["old"])
    reminder = logged("reminder")
    check("reminder: pay button in ROW azure", bool(reminder and reminder["azure"]))

    project = sql(f"INSERT INTO `{projects}` (fk_club_id, fk_module_id, fk_year_id, title, description, isdeleted, is_active) "
                  f"VALUES ({club}, {module}, {year_id}, '{CARD_TITLE}', 'Temporary project for the rebranding e2e.', 0, 1); "
                  "SELECT LAST_INSERT_ID();")
    s, png = request("GET", f"/api/public/projects/{project}/share-image.png?yearId={year_id}", raw=True)
    check("share card drawn", s == 200 and png[:4] == b"\x89PNG", s)
    if s == 200:
        px = png_pixels(png)
        check("share card uses ROW azure", px.count(AZURE) > 1000, px.count(AZURE))
        check("share card has none of its former navy", px.count(OLD_NAVY) == 0, px.count(OLD_NAVY))
finally:
    sql(f"DELETE FROM email_log WHERE recipient_email='{TO}'")
    if project:
        sql(f"DELETE FROM `{projects}` WHERE pk_project_id={project} AND title='{CARD_TITLE}'")
        for f in (CARD_CACHE / year_label).glob(f"p{project}-*.png") if (CARD_CACHE / year_label).is_dir() else []:
            f.unlink()
    check("e2e rows removed",
          sql(f"SELECT COUNT(*) FROM email_log WHERE recipient_email='{TO}'") == "0"
          and sql(f"SELECT COUNT(*) FROM `{projects}` WHERE title='{CARD_TITLE}'") == "0")

print("ALL PASS" if fails == 0 else f"{fails} FAILED")
sys.exit(1 if fails else 0)

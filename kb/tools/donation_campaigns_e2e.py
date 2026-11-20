"""Donation campaigns (gap #13): a club admin opens a campaign with a goal, dates and suggested amounts; the public
giving page takes donations through the hosted checkout (the SIMULATED gateway: Stripe is not wired yet); progress,
analytics, donor export, QR code and tax receipt letters (editable template) follow. Also: role and scope checks
(no IDOR), server-side amount rules, the honeypot, one settlement per payment, and what the public may see.

    python -I kb/tools/donation_campaigns_e2e.py <api_base> <mysql_port> <database>

Start the API with JwtSettings__Secret = ROW_E2E_JWT_SECRET, Payments__Provider=simulated (Development only) and NO
Brevo key (Brevo__ApiKey empty): the thank-you email then fails safely and is only logged. Donor addresses are
@example.invalid anyway. Uses club 341 (admin member 1068) and ordinary member 999 of the LOCAL copy. Everything it
creates (campaigns, donations, checkout sessions, the receipt template, the uploaded image) is removed at the end.
Never run it against production.
"""
import base64, hashlib, hmac, json, os, secrets, struct, subprocess, sys, time, urllib.error, urllib.request, zlib

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
WWWROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'row', 'api', 'wwwroot')
CLUB, ADMIN, MEMBER = 341, 1068, 999
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, raw=None, ctype=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"X-Forwarded-For": f"10.9.{secrets.randbelow(250)}.{secrets.randbelow(250)}"}  # own rate-limit bucket
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    if data is not None:
        headers["Content-Type"] = ctype or "application/json"
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            payload, status, rtype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        payload, status, rtype = e.read(), e.code, e.headers.get("Content-Type", "")
    if "json" in rtype and payload:
        return status, json.loads(payload)
    return status, payload


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


def png(w=4, h=4):
    raw = b''.join(b'\x00' + b'\x17\x45\x8f' * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


district = int(sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id={CLUB}"))
other_club = int(sql(f"SELECT pk_club_id FROM club_master WHERE pk_club_id<>{CLUB} AND IsActive=1 ORDER BY pk_club_id LIMIT 1"))
had_template = sql(f"SELECT COUNT(*) FROM donation_receipt_templates WHERE scope_type='club' AND scope_id={CLUB}") != '0'
admin, member = token(ADMIN, "Admin"), token(MEMBER, "Member")
base = f"/api/clubs/{CLUB}/donation-campaigns"
campaigns, image_path = [], None

try:
    # ── Roles and scope ─────────────────────────────────────────────────────────────────────────────────────
    check("ordinary member cannot list the club's campaigns", call("GET", base, member)[0] == 403)
    check("anonymous caller cannot list", call("GET", base)[0] == 401)
    check("club admin cannot manage another club", call("GET", f"/api/clubs/{other_club}/donation-campaigns", admin)[0] == 403)
    check("club admin cannot manage the district", call("GET", f"/api/districts/{district}/donation-campaigns", admin)[0] == 403)

    # ── Image upload, create and validation ─────────────────────────────────────────────────────────────────
    b = "----e2e" + secrets.token_hex(8)
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n').encode() \
        + png(400, 300) + f"\r\n--{b}--\r\n".encode()
    s, up = call("POST", f"{base}/image", admin, raw=body, ctype=f"multipart/form-data; boundary={b}")
    image_path = up.get("path") if isinstance(up, dict) else None
    check("campaign image uploads", s == 200 and image_path and image_path.startswith("/Documents/donations/"), (s, up))

    camp = {"title": "e2e Clean water wells", "description": "Wells for two schools.", "imageUrl": image_path,
            "goalAmount": 1000, "tiers": [25, 50, 100], "allowCustom": True, "minAmount": 10,
            "startDate": time.strftime("%Y-%m-%d", time.gmtime(time.time() - 86400)),
            "endDate": time.strftime("%Y-%m-%d", time.gmtime(time.time() + 30 * 86400)), "isActive": True}
    s, r = call("POST", base, admin, camp)
    cid = r.get("id") if isinstance(r, dict) else None
    if cid: campaigns.append(cid)
    check("club admin creates a campaign", s == 200 and cid, (s, r))
    check("end before start is refused", call("POST", base, admin, {**camp, "startDate": "2026-12-10", "endDate": "2026-12-01"})[0] == 400)
    check("foreign image URL is refused", call("POST", base, admin, {**camp, "imageUrl": "https://evil.example/x.png"})[0] == 400)
    check("ordinary member cannot create", call("POST", base, member, camp)[0] == 403)
    check("another club's admin path cannot read this campaign", call("GET", f"/api/clubs/{other_club}/donation-campaigns/{cid}", admin)[0] == 403)
    check("campaign of this club under a wrong id is 404", call("GET", f"{base}/{cid + 100000}", admin)[0] == 404)

    # ── Public page ─────────────────────────────────────────────────────────────────────────────────────────
    s, pub = call("GET", f"/api/public/donations/{cid}")
    check("public campaign page loads and is open", s == 200 and pub["campaign"]["isOpen"] and pub["campaign"]["tiers"] == [25, 50, 100], (s, pub))
    check("public page names the club", s == 200 and pub.get("organisation"), pub)
    s, lst = call("GET", f"/api/public/club/{CLUB}/donation-campaigns")
    check("club website list includes the open campaign with its giving URL",
          s == 200 and any(c["id"] == cid and f"/public/donate/{cid}" in (c.get("givingUrl") or "") for c in lst), (s, lst))

    # ── Donations through the simulated checkout ────────────────────────────────────────────────────────────
    donor = {"name": "Priya E2e Fernando", "email": "priya.e2e@example.invalid", "message": "For the wells", "amount": 5}
    s, r = call("POST", f"/api/public/donations/{cid}/donate", body=donor)
    check("amount under the minimum is refused by the server", s == 400 and "smallest" in r.get("message", ""), (s, r))
    s, r = call("POST", f"/api/public/donations/{cid}/donate", body={**donor, "amount": 10.555})
    check("three decimals are refused", s == 400, (s, r))
    s, r = call("POST", f"/api/public/donations/{cid}/donate", body={**donor, "amount": 50, "email": "not-an-email"})
    check("bad email is refused", s == 400, (s, r))
    before = sql(f"SELECT COUNT(*) FROM donations WHERE fk_campaign_id={cid}")
    s, r = call("POST", f"/api/public/donations/{cid}/donate", body={**donor, "amount": 50, "website": "http://spam"})
    check("honeypot: refused and nothing stored", s == 400 and sql(f"SELECT COUNT(*) FROM donations WHERE fk_campaign_id={cid}") == before, (s, r))

    s, co = call("POST", f"/api/public/donations/{cid}/donate", body={**donor, "amount": 50})
    check("donation starts a hosted checkout", s == 200 and "/pay/simulated/" in co.get("redirectUrl", ""), (s, co))
    tok, order = co["token"], co["merchantOrderId"]
    s, sess = call("GET", f"/api/public/payments/checkout/{tok}")
    check("checkout amount is the server's, return URL is the giving page",
          s == 200 and float(sess["amount"]) == 50 and f"/public/donate/{cid}?order={order}" in (sess.get("returnUrl") or ""), (s, sess))
    check("pending donation before payment", call("GET", f"/api/public/donations/{cid}/order/{order}?token={tok}")[1].get("status") == "pending")
    s, r = call("POST", f"/api/public/payments/checkout/{tok}/simulate", body={"outcome": "paid"})
    check("simulated payment settles", s == 200 and r.get("status") == "paid", (s, r))
    call("POST", f"/api/public/payments/checkout/{tok}/simulate", body={"outcome": "paid"})
    check("a repeated confirmation counts the money once",
          sql(f"SELECT CONCAT(COUNT(*), ':', SUM(amount)) FROM donations WHERE fk_campaign_id={cid} AND status='paid'") == "1:50.00")
    s, st = call("GET", f"/api/public/donations/{cid}/order/{order}?token={tok}")
    check("donor sees the paid status", s == 200 and st.get("status") == "paid", (s, st))
    check("wrong token shows nothing", call("GET", f"/api/public/donations/{cid}/order/{order}?token={'0' * 64}")[0] == 404)
    s, pdf = call("GET", f"/api/public/donations/{cid}/order/{order}/receipt?token={tok}")
    check("donor downloads the receipt PDF", s == 200 and pdf[:4] == b"%PDF", s)

    s, co2 = call("POST", f"/api/public/donations/{cid}/donate",
                  body={"name": "Hidden Donor", "email": "hidden.e2e@example.invalid", "amount": 100, "anonymous": True,
                        "hideAmount": True, "message": "private note"})
    call("POST", f"/api/public/payments/checkout/{co2['token']}/simulate", body={"outcome": "paid"})
    s, co3 = call("POST", f"/api/public/donations/{cid}/donate", body={**donor, "amount": 25})
    call("POST", f"/api/public/payments/checkout/{co3['token']}/simulate", body={"outcome": "failed"})
    s, pub = call("GET", f"/api/public/donations/{cid}")
    text = json.dumps(pub)
    check("public page never shows emails or surnames", "example.invalid" not in text and "Fernando" not in text, text[:300])
    anon = [d for d in pub["recentDonors"] if d["name"] == "Anonymous"]
    check("anonymous donor shows without amount or message", anon and anon[0]["amount"] is None and anon[0]["message"] is None, pub["recentDonors"])
    check("progress counts paid donations only", float(pub["campaign"]["progress"]["raised"]) == 150 and pub["campaign"]["progress"]["percent"] == 15, pub["campaign"]["progress"])

    # ── Manager analytics, export, QR, receipts ─────────────────────────────────────────────────────────────
    s, rep = call("GET", f"{base}/{cid}", admin)
    check("report: total, count, average, pending, daily",
          s == 200 and float(rep["total"]) == 150 and rep["count"] == 2 and float(rep["average"]) == 75 and len(rep["daily"]) == 1, (s, rep))
    check("report: top donors", s == 200 and rep["topDonors"][0]["name"] == "Hidden Donor", rep.get("topDonors"))
    s, xl = call("GET", f"{base}/{cid}/export", admin)
    check("donor list exports as xlsx", s == 200 and xl[:2] == b"PK", s)
    check("ordinary member cannot export", call("GET", f"{base}/{cid}/export", member)[0] == 403)
    s, qr = call("GET", f"{base}/{cid}/qr", admin)
    check("QR code PNG of the giving page", s == 200 and qr[:4] == b"\x89PNG", s)
    paid_id = int(sql(f"SELECT pk_donation_id FROM donations WHERE merchant_order_id='{order}'"))
    s, pdf = call("GET", f"{base}/{cid}/donations/{paid_id}/receipt", admin)
    check("manager downloads a donor's receipt", s == 200 and pdf[:4] == b"%PDF", s)
    failed_id = int(sql(f"SELECT pk_donation_id FROM donations WHERE merchant_order_id='{co3['merchantOrderId']}'"))
    check("no receipt for an unpaid donation", call("GET", f"{base}/{cid}/donations/{failed_id}/receipt", admin)[0] == 404)

    # ── Receipt letter template ─────────────────────────────────────────────────────────────────────────────
    tpl = {"legalName": "Rotary Club e2e Trust", "taxStatement": "Registered charity no. E2E-123. No goods or services were given.",
           "body": "Dear {donor_name},\n\nThank you for {amount} {currency}.", "signatoryName": "E2e Treasurer", "signatoryTitle": "Treasurer"}
    check("template saves", call("PUT", f"/api/clubs/{CLUB}/donation-receipt-template", admin, tpl)[0] == 204)
    s, t = call("GET", f"/api/clubs/{CLUB}/donation-receipt-template", admin)
    check("template reads back with placeholders listed", s == 200 and t["template"]["taxStatement"] == tpl["taxStatement"] and "donor_name" in t["placeholders"], (s, t))
    s, pdf = call("POST", f"/api/clubs/{CLUB}/donation-receipt-template/preview", admin, tpl)
    check("template preview is a PDF", s == 200 and pdf[:4] == b"%PDF", s)
    check("too long template is refused", call("PUT", f"/api/clubs/{CLUB}/donation-receipt-template", admin, {**tpl, "body": "x" * 5001})[0] == 400)
    check("ordinary member cannot edit the template", call("PUT", f"/api/clubs/{CLUB}/donation-receipt-template", member, tpl)[0] == 403)

    # ── The app ─────────────────────────────────────────────────────────────────────────────────────────────
    s, mine = call("GET", "/api/mobile/donations", member)
    check("member of the club sees the open campaign in the app", s == 200 and any(c["id"] == cid for c in mine), (s, mine))

    # ── Closing ─────────────────────────────────────────────────────────────────────────────────────────────
    check("campaign updates (closed)", call("PUT", f"{base}/{cid}", admin, {**camp, "isActive": False})[0] == 204)
    s, r = call("POST", f"/api/public/donations/{cid}/donate", body={**donor, "amount": 50})
    check("closed campaign takes no donations", s == 400, (s, r))
    s, mine = call("GET", "/api/mobile/donations", member)
    check("closed campaign leaves the app list", s == 200 and all(c["id"] != cid for c in mine))
    check("delete is soft and hides the campaign", call("DELETE", f"{base}/{cid}", admin)[0] == 204
          and call("GET", f"/api/public/donations/{cid}")[0] == 404)
finally:
    for c in campaigns:
        orders = sql(f"SELECT GROUP_CONCAT(QUOTE(merchant_order_id)) FROM donations WHERE fk_campaign_id={c}")
        if orders and orders != 'NULL':
            sql(f"DELETE FROM payment_checkout_sessions WHERE merchant_order_id IN ({orders})")
        sql(f"DELETE FROM donations WHERE fk_campaign_id={c}")
        sql(f"DELETE FROM donation_campaigns WHERE pk_campaign_id={c}")
    if not had_template:
        sql(f"DELETE FROM donation_receipt_templates WHERE scope_type='club' AND scope_id={CLUB}")
    if image_path:
        p = os.path.join(WWWROOT, *image_path.strip('/').split('/'))
        if os.path.exists(p):
            os.remove(p)
    left = sql(f"SELECT COUNT(*) FROM donation_campaigns WHERE title LIKE 'e2e %'")
    print(f"cleanup: campaigns left {left}")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

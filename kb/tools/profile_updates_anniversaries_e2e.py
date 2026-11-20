"""Profile update requests + years-of-service / anniversaries report (competitor gaps #3, #4), 2026-11-19.

    python -I kb/tools/profile_updates_anniversaries_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Local copies only, never
production. Set ROW_E2E_EMAIL_SAFE=1 and run the API with Brevo__ApiUrl pointing at a dead local URL: the request
email to the test member is attempted and must fail locally (email_log shows it failed). Test identities: club admin
1068 and member 999 of club 341 (Colombo West); an outsider is looked up. Test rows: requests for member 999 created
after the start time plus rows inserted with requested_by -25; all are removed at the end, and member 999's profile
fields touched by the link are put back.
"""
import base64, hashlib, hmac, json, os, secrets, subprocess, sys, time, urllib.error, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
if os.environ.get('ROW_E2E_EMAIL_SAFE') != '1':
    sys.exit("Set ROW_E2E_EMAIL_SAFE=1 and point the API's Brevo at a dead local URL first.")
if 'production' in DB:
    sys.exit("Refusing to run against a production database.")
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
CLUB, ADMIN, MEMBER, M = 341, 1068, 999, -25
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


def raw(method, path, tok=None, body=None):
    headers = {"Authorization": f"Bearer {tok}"} if tok else {}
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def call(method, path, tok=None, body=None):
    s, _, b = raw(method, path, tok, body)
    try:
        return s, json.loads(b) if b else None
    except ValueError:
        return s, b.decode(errors="replace")


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


start = sql("SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s')")
log_start = int(sql("SELECT IFNULL(MAX(pk_id), 0) FROM email_log"))
outsider = int(sql(f"""SELECT cm.fk_member_master_profile_id FROM club_members cm
    WHERE cm.fk_club_id <> {CLUB} AND cm.IsActive = 1 AND cm.isdeleted = 0
      AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles)
      AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id = {CLUB})
    LIMIT 1"""))
saved = sql(f"""SELECT CONCAT_WS('|', IFNULL(SecondaryEmailId,'~'), IFNULL(SecondaryMobileNumber,'~'), IFNULL(BirthDate,'~'),
    IFNULL(AnniversaryDate,'~'), IFNULL(MemberIntroduction,'~'), IFNULL(LinkedIn,'~'), IFNULL(Website,'~'),
    IFNULL(DATE_FORMAT(modified_date, '%Y-%m-%d %H:%i:%s'),'~'), IFNULL(modified_by,'~'))
    FROM member_master_profile WHERE pk_member_master_profile_id = {MEMBER}""")
saved_class = sql(f"""SELECT CONCAT_WS('|', IFNULL(ClassificationProfession,'~'), IFNULL(modified_by,'~'),
    IFNULL(DATE_FORMAT(modified_date, '%Y-%m-%d %H:%i:%s'),'~'))
    FROM club_members WHERE fk_club_id = {CLUB} AND fk_member_master_profile_id = {MEMBER} AND IsActive = 1 AND isdeleted = 0""")
t_admin, t_member, t_out = token(ADMIN, ["Admin"]), token(MEMBER, ["Member"]), token(outsider, ["Member"])

try:
    # ── Access: request screens are for the club's managers; the report for its members ──
    s, body = call("GET", f"/api/clubs/{CLUB}/profile-updates/members", t_admin)
    check("admin lists members with missing fields", s == 200 and isinstance(body, list) and len(body) > 0
          and all("missing" in r for r in body), f"{s} {str(body)[:200]}")
    if s != 200:
        sys.exit("cannot continue without the member list")
    me = next((r for r in body if r["memberId"] == MEMBER), None)
    check("member 999 is in the club list", me is not None)
    incomplete = sum(1 for r in body if r["missing"])
    s, _ = call("GET", f"/api/clubs/{CLUB}/profile-updates/members", t_member)
    check("ordinary member cannot list request candidates", s == 403, s)
    s, _ = call("POST", f"/api/clubs/{CLUB}/profile-updates/requests", t_member, {"memberIds": [MEMBER]})
    check("ordinary member cannot send requests", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{CLUB}/profile-updates/requests", t_out)
    check("outsider cannot read the club's requests", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{CLUB}/profile-updates/members")
    check("anonymous is refused", s == 401, s)

    # ── Validation ──
    s, body = call("POST", f"/api/clubs/{CLUB}/profile-updates/requests", t_admin, {"memberIds": []})
    check("empty choice is refused", s == 400, f"{s} {body}")
    s, body = call("POST", f"/api/clubs/{CLUB}/profile-updates/requests", t_admin, {"memberIds": [MEMBER], "message": "x" * 1001})
    check("over-long note is refused", s == 400, f"{s} {body}")

    # ── Send to one member (plus one id from outside the club, which is skipped) ──
    s, body = call("POST", f"/api/clubs/{CLUB}/profile-updates/requests", t_admin,
                   {"memberIds": [MEMBER, outsider], "message": "E2E N25 please check"})
    check("admin sends a request", s == 200 and body.get("requested") == 1 and body.get("skipped") == 1, f"{s} {body}")
    row = sql(f"""SELECT email_status, requested_by, TIMESTAMPDIFF(DAY, requested_at, expires_at) FROM profile_update_requests
                  WHERE fk_member_id = {MEMBER} AND fk_club_id = {CLUB} AND requested_at >= '{start}' ORDER BY pk_request_id DESC LIMIT 1""")
    check("request row stored (UTC, 30-day link, requested by the admin)", row.split('\t')[1:] == [str(ADMIN), "30"], row)
    check("no request for the outsider", sql(f"SELECT COUNT(*) FROM profile_update_requests WHERE fk_member_id = {outsider} AND requested_at >= '{start}'") == "0")
    check("token itself is not stored (64-char hash)", sql(f"SELECT MIN(LENGTH(token_hash)) FROM profile_update_requests WHERE fk_member_id = {MEMBER}") == "64")
    if row.split('\t')[0] == "emailed":
        st = sql(f"SELECT GROUP_CONCAT(DISTINCT status) FROM email_log WHERE pk_id > {log_start} AND subject = 'Please check your member profile'")
        check("request email attempted and nothing actually sent (dead local Brevo)", st != "" and "sent" not in st.split(','), st)

    s, body = call("GET", f"/api/clubs/{CLUB}/profile-updates/requests", t_admin)
    mine = next((r for r in body or [] if r["memberId"] == MEMBER), None)
    check("history shows the request as pending", s == 200 and mine and mine["status"] == "pending", f"{s} {mine}")

    # ── In-app: the member's bell has the request ──
    s, body = call("GET", "/api/mobile/notifications?types=profile_update&pageSize=50&days=30", t_member)
    items = [i for i in (body or {}).get("items", []) if i.get("type") == "profile_update"] if s == 200 else []
    check("member's bell shows the request", len(items) >= 1, f"{s} {str(body)[:300]}")
    check("bell item carries the admin's note", any("E2E N25" in (i.get("body") or "") for i in items), items[:1])

    # ── A second send replaces the open request ──
    s, body = call("POST", f"/api/clubs/{CLUB}/profile-updates/requests", t_admin, {"memberIds": [MEMBER]})
    open_count = sql(f"""SELECT COUNT(*) FROM profile_update_requests WHERE fk_member_id = {MEMBER} AND fk_club_id = {CLUB}
                        AND completed_at IS NULL AND expires_at > UTC_TIMESTAMP()""")
    check("resend leaves one open request", s == 200 and open_count == "1", f"{s} {open_count}")

    # ── The emailed link (a test row with a token we know) ──
    tok = secrets.token_urlsafe(32)
    assert len(tok) == 43
    h = hashlib.sha256(tok.encode()).hexdigest()
    sql(f"""INSERT INTO profile_update_requests (fk_club_id, fk_member_id, token_hash, requested_by, requested_at, expires_at, email_status)
            VALUES ({CLUB}, {MEMBER}, '{h}', {M}, UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL 30 DAY, 'emailed')""")
    s, body = call("GET", f"/api/public/profile-update/{tok}")
    check("link opens without sign-in", s == 200 and body.get("memberName") and body.get("alreadyUpdated") is False, f"{s} {body}")
    s, _ = call("GET", f"/api/public/profile-update/{secrets.token_urlsafe(32)}")
    check("unknown token is 404", s == 404, s)
    s, _ = call("GET", "/api/public/profile-update/short")
    check("malformed token is 404", s == 404, s)
    s, body = call("POST", f"/api/public/profile-update/{tok}", None, {"website": "javascript:alert(1)"})
    check("bad website refused", s == 400, f"{s} {body}")
    s, body = call("POST", f"/api/public/profile-update/{tok}", None, {
        "secondaryEmailId": "e2e.n25@example.org", "memberIntroduction": "E2E N25 intro",
        "website": "https://example.org/n25", "birthDate": "1971-11-05", "classificationProfession": "E2E N25 Law"})
    check("link saves the form", s == 200, f"{s} {body}")
    got = sql(f"SELECT CONCAT_WS('|', SecondaryEmailId, MemberIntroduction, Website, BirthDate) FROM member_master_profile WHERE pk_member_master_profile_id = {MEMBER}")
    check("profile fields updated", got == "e2e.n25@example.org|E2E N25 intro|https://example.org/n25|1971-11-05", got)
    check("classification updated on the club membership",
          sql(f"SELECT ClassificationProfession FROM club_members WHERE fk_club_id = {CLUB} AND fk_member_master_profile_id = {MEMBER} AND IsActive = 1 AND isdeleted = 0") == "E2E N25 Law")
    check("request marked done via link", sql(f"SELECT completed_via FROM profile_update_requests WHERE token_hash = '{h}'") == "link")
    s, body = call("GET", f"/api/public/profile-update/{tok}")
    check("link shows already updated", s == 200 and body.get("alreadyUpdated") is True, f"{s} {body}")

    # confirm-only on another test row
    tok2 = secrets.token_urlsafe(32)
    h2 = hashlib.sha256(tok2.encode()).hexdigest()
    sql(f"""INSERT INTO profile_update_requests (fk_club_id, fk_member_id, token_hash, requested_by, requested_at, expires_at, email_status)
            VALUES ({CLUB}, {MEMBER}, '{h2}', {M}, UTC_TIMESTAMP(), UTC_TIMESTAMP() + INTERVAL 30 DAY, 'emailed')""")
    s, body = call("POST", f"/api/public/profile-update/{tok2}", None, {"confirmOnly": True})
    check("confirm-only marks done without changing the profile", s == 200
          and sql(f"SELECT completed_via FROM profile_update_requests WHERE token_hash = '{h2}'") == "confirm", f"{s} {body}")
    # expired link
    tok3 = secrets.token_urlsafe(32)
    h3 = hashlib.sha256(tok3.encode()).hexdigest()
    sql(f"""INSERT INTO profile_update_requests (fk_club_id, fk_member_id, token_hash, requested_by, requested_at, expires_at, email_status)
            VALUES ({CLUB}, {MEMBER}, '{h3}', {M}, UTC_TIMESTAMP() - INTERVAL 40 DAY, UTC_TIMESTAMP() - INTERVAL 10 DAY, 'emailed')""")
    s, _ = call("POST", f"/api/public/profile-update/{tok3}", None, {"confirmOnly": True})
    check("expired link refused", s == 404, s)
    s, body = call("GET", f"/api/clubs/{CLUB}/profile-updates/requests", t_admin)
    statuses = {r["status"] for r in body or [] if r["memberId"] == MEMBER}
    check("history shows updated and expired", {"updated", "expired"} <= statuses, statuses)

    # ── Anniversaries report ──
    s, body = call("GET", f"/api/clubs/{CLUB}/anniversaries", t_member)
    check("member reads this month's report", s == 200 and body["month"] in range(1, 13) and body["counts"]["members"] == len(body["members"]),
          f"{s} {str(body)[:200]}")
    s, body = call("GET", f"/api/clubs/{CLUB}/anniversaries?year=2026&month=11", t_admin)
    check("admin reads November 2026", s == 200 and body["year"] == 2026 and body["month"] == 11, f"{s} {str(body)[:200]}")
    me_row = next((r for r in body["members"] if r["memberId"] == MEMBER), None) if s == 200 else None
    check("birthday saved through the link shows in November (day 5)", me_row and me_row["birthdayDay"] == 5, me_row)
    ok = all((r["milestone"] is False) or (r["anniversaryYears"] and (r["anniversaryYears"] % 5 == 0 or r["anniversaryYears"] in (1, 3, 5, 10)))
             for r in body["members"]) if s == 200 else False
    check("milestones only on milestone years", ok)
    ms = sql(f"""SELECT COUNT(*) FROM (SELECT MIN(cm.JoinedDate) j FROM club_members cm JOIN member_master_profile m
                 ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0
                 WHERE cm.fk_club_id = {CLUB} AND cm.IsActive = 1 AND IFNULL(cm.isdeleted, 0) = 0
                 GROUP BY m.pk_member_master_profile_id) x WHERE MONTH(j) = 11 AND YEAR(j) < 2026 AND YEAR(j) >= 1900""")
    check("joining anniversaries match the database", s == 200 and body["counts"]["joiningAnniversaries"] == int(ms),
          f"{body['counts'] if s == 200 else s} vs {ms}")
    s, hdr, data = raw("GET", f"/api/clubs/{CLUB}/anniversaries?year=2026&month=11&format=csv", t_admin)
    text = data.decode("utf-8-sig") if s == 200 else ""
    check("CSV export downloads", s == 200 and "text/csv" in hdr.get("Content-Type", "") and text.startswith("Member,Joined,Years of service"),
          f"{s} {hdr.get('Content-Type')} {text[:80]}")
    check("CSV has one line per member", text.count("\r\n") == body["counts"]["members"] + 1 if s == 200 else False)
    s, _ = call("GET", f"/api/clubs/{CLUB}/anniversaries", t_out)
    check("outsider cannot read the club's report", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{CLUB}/anniversaries?month=13", t_admin)
    check("month 13 refused", s == 400, s)
    print(f"INFO club {CLUB}: {incomplete} members with an incomplete profile")
finally:
    sql(f"DELETE FROM profile_update_requests WHERE fk_member_id = {MEMBER} AND (requested_by = {M} OR requested_at >= '{start}')")
    sql(f"DELETE FROM profile_update_requests WHERE fk_member_id = {outsider} AND requested_at >= '{start}'")
    sql(f"DELETE FROM email_log WHERE pk_id > {log_start} AND subject = 'Please check your member profile' AND status <> 'sent'")
    p = saved.split('|')
    def v(x, quote=True):
        return "NULL" if x == '~' else ("'" + x.replace("\\", "\\\\").replace("'", "\\'") + "'" if quote else x)
    sql(f"""UPDATE member_master_profile SET SecondaryEmailId = {v(p[0])}, SecondaryMobileNumber = {v(p[1])}, BirthDate = {v(p[2])},
            AnniversaryDate = {v(p[3])}, MemberIntroduction = {v(p[4])}, LinkedIn = {v(p[5])}, Website = {v(p[6])},
            modified_date = {v(p[7])}, modified_by = {v(p[8], False)} WHERE pk_member_master_profile_id = {MEMBER}""")
    c = saved_class.split('|')
    sql(f"""UPDATE club_members SET ClassificationProfession = {v(c[0])}, modified_by = {v(c[1], False)}, modified_date = {v(c[2])}
            WHERE fk_club_id = {CLUB} AND fk_member_master_profile_id = {MEMBER} AND IsActive = 1 AND isdeleted = 0""")
    left = sql(f"SELECT COUNT(*) FROM profile_update_requests WHERE fk_member_id IN ({MEMBER}, {outsider}) AND (requested_by = {M} OR requested_at >= '{start}')")
    restored = sql(f"""SELECT CONCAT_WS('|', IFNULL(SecondaryEmailId,'~'), IFNULL(SecondaryMobileNumber,'~'), IFNULL(BirthDate,'~'),
        IFNULL(AnniversaryDate,'~'), IFNULL(MemberIntroduction,'~'), IFNULL(LinkedIn,'~'), IFNULL(Website,'~'),
        IFNULL(DATE_FORMAT(modified_date, '%Y-%m-%d %H:%i:%s'),'~'), IFNULL(modified_by,'~'))
        FROM member_master_profile WHERE pk_member_master_profile_id = {MEMBER}""")
    check("cleanup: test rows removed and member 999 restored", left == "0" and restored == saved, f"{left} {restored} vs {saved}")

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

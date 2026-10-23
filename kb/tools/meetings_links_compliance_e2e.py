"""N8 Meetings: pasted join links in reminders and calendar feeds, meeting compliance (lane d, 2026-10-23).

    python -I kb/tools/meetings_links_compliance_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Local copies only,
never production. Creates meetings in one real club (through the API), turns the 'meetings' feature on for the run,
and puts everything back at the end: meetings, feed tokens, rules and the feature switch. audit_log rows stay
(append-only by design). The email reminder job is not driven here: it would email the club's real members.
"""
import base64, hashlib, hmac, json, os, re, secrets, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, body=None, tok=None, raw=False):
    """(status, parsed JSON or raw bytes, content type). A full URL is called by its path: Api:BaseUrl may name
    another host than the API under test."""
    url = API + (urllib.parse.urlparse(path).path if path.startswith("http") else path)
    headers = {"Content-Type": "application/json", **({"Authorization": f"Bearer {tok}"} if tok else {})}
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data, status, ctype = r.read(), r.status, r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        data, status, ctype = e.read(), e.code, e.headers.get("Content-Type", "")
    if raw:
        return status, data, ctype
    try:
        return status, json.loads(data or b"{}"), ctype
    except ValueError:
        return status, {}, ctype


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def unfold(ics):
    return ics.replace("\r\n ", "")


# A club with an active Admin in an active district and zone, a plain member of it, a club in another district,
# and a SuperAdmin. Nothing hard-coded.
club, district = [int(x) for x in sql(
    "SELECT c.pk_club_id, c.fk_district_id FROM club_master c "
    "JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1 "
    "JOIN zone_master z ON z.pk_zone_id = d.fk_zone_id AND z.isdeleted = 0 AND z.IsActive = 1 "
    "JOIN member_roles r ON r.fk_club_id = c.pk_club_id AND r.fk_role_id = 2 AND r.IsActive = 1 AND r.isdeleted = 0 "
    "WHERE IFNULL(c.isdeleted, 0) = 0 AND c.IsActive = 1 AND EXISTS (SELECT 1 FROM club_members cm "
    "WHERE cm.fk_club_id = c.pk_club_id AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.fk_member_master_profile_id "
    "NOT IN (SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id <> 1 AND IsActive = 1)) "
    "ORDER BY c.pk_club_id LIMIT 1").split()]
other = int(sql(f"SELECT pk_club_id FROM club_master WHERE fk_district_id <> {district} AND IFNULL(isdeleted, 0) = 0 "
                "ORDER BY 1 LIMIT 1"))
admin = int(sql(f"SELECT fk_member_master_profile_id FROM member_roles WHERE fk_club_id = {club} AND fk_role_id = 2 "
                "AND IsActive = 1 AND isdeleted = 0 LIMIT 1"))
plain = int(sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm "
                f"JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id AND m.isdeleted = 0 "
                f"WHERE cm.fk_club_id = {club} AND cm.IsActive = 1 AND cm.isdeleted = 0 AND cm.fk_member_master_profile_id "
                "NOT IN (SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id <> 1 AND IsActive = 1) LIMIT 1"))
sa = int(sql("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id = 3 AND IsActive = 1 AND isdeleted = 0 LIMIT 1"))
t_plain, t_admin, t_sa = token(plain, "Member"), token(admin, "Admin"), token(sa, "SuperAdmin")

# What to put back afterwards.
had_switch = sql("SELECT COUNT(*) FROM platform_features WHERE feature_key = 'meetings'") == "1"
was_on = sql("SELECT COALESCE(MAX(enabled), 0) FROM platform_features WHERE feature_key = 'meetings'") == "1"
saved_feeds = sql(f"SELECT token, IFNULL(fk_club_id, 'NULL'), IFNULL(fk_member_id, 'NULL'), IFNULL(created_by, 'NULL') "
                  f"FROM meeting_calendar_feeds WHERE fk_club_id = {club} OR fk_member_id = {plain}")
saved_rules = sql(f"SELECT IFNULL(fk_district_id, 'NULL'), IFNULL(fk_club_id, 'NULL'), MeetingsPerMonth FROM meeting_rules "
                  f"WHERE fk_district_id = {district} OR fk_club_id = {club}")
created = []
base = f"/api/clubs/{club}/attendance"
link = f"https://teams.microsoft.com/l/meetup-join/e2e-{secrets.token_hex(6)}"
soon = sql("SELECT DATE_FORMAT(NOW() + INTERVAL 2 HOUR, '%Y-%m-%dT%H:%i:00')")
last_month = sql("SELECT DATE_FORMAT(NOW() - INTERVAL 1 MONTH, '%Y-%m')")
this_month = sql("SELECT DATE_FORMAT(NOW(), '%Y-%m')")
fake_token = "A" * 64


def meeting(name, when, mode="online", url=link, members=()):
    s, b, _ = call("POST", base, {"eventName": name, "description": "Agenda: budget, speakers; Café review " + "x" * 80,
                                  "eventDateTime": when, "meetingMode": mode, "meetingLink": url,
                                  "memberIds": list(members)}, t_admin)
    if s == 200 and b.get("id"):
        created.append(b["id"])
    return s, b


def switch(on):
    s, _, _ = call("PUT", "/api/features/meetings", {"enabled": on}, t_sa)
    return s


def compliance(month, tok=t_sa):
    s, b, _ = call("GET", f"/api/districts/{district}/meeting-compliance?month={month}", tok=tok)
    return s, next((c for c in b.get("clubs", []) if c.get("clubId") == club), {}) if s == 200 else b


try:
    # ── switched off: the module answers 404, the link itself (ROW Wave 1) keeps working ──
    check("switch off", switch(False) == 204)
    for name, method, path in [("club calendar feed", "GET", f"/api/clubs/{club}/calendar-feed"),
                               ("public iCal feed", "GET", f"/api/public/calendar/{fake_token}.ics"),
                               ("district compliance", "GET", f"/api/districts/{district}/meeting-compliance")]:
        s, b, _ = call(method, path, tok=t_sa)
        check(f"off: {name} is closed", s == 404 and b.get("feature") == "meetings", (s, b))

    s, b = meeting("e2e weekly meeting, online; with notes", soon)
    check("an online meeting with a pasted Teams link is saved", s == 200, (s, b))
    s, b = meeting("e2e bad link", soon, url="http://example.org/join")
    check("a non-https link is refused", s == 400, (s, b))
    m1 = created[0] if created else 0
    s, b, _ = call("GET", "/api/mobile/notifications?types=meeting&pageSize=50", tok=t_plain)
    check("off: no meeting reminder in the app feed",
          s == 200 and not any(i.get("type") == "meeting" for i in b.get("items", [])), (s, b))

    # ── switched on ──
    check("switch on", switch(True) == 204)
    s, b, _ = call("GET", "/api/mobile/notifications?types=meeting&pageSize=50", tok=t_plain)
    item = next((i for i in b.get("items", []) if i.get("type") == "meeting" and i.get("id") == m1), {})
    check("in-app reminder carries the join link", item.get("linkUrl") == link and link in (item.get("body") or ""), (s, item))
    check("in-app reminder deep link names the club meeting",
          (item.get("deepLink") or {}).get("type") == "club_meeting" and item.get("clubId") == club, item)
    s, d, _ = call("GET", f"{base}/{m1}", tok=t_plain)
    check("the app's meeting API returns mode and link to a member", s == 200 and d.get("meetingLink") == link, (s, d))

    # ── club calendar feed ──
    s, b, _ = call("POST", f"/api/clubs/{club}/calendar-feed", tok=t_plain)
    check("a plain member cannot issue the club feed URL", s == 403, (s, b))
    s, b, _ = call("GET", f"/api/clubs/{other}/calendar-feed", tok=t_plain)
    check("a member cannot read another club's feed URL", s == 403, (s, b))
    s, b, _ = call("POST", f"/api/clubs/{club}/calendar-feed", tok=t_admin)
    club_url = b.get("url") or ""
    check("the club admin issues the club feed URL", s == 200 and re.search(r"/api/public/calendar/[0-9A-F]{64}\.ics$", club_url), (s, b))
    s, b, _ = call("GET", f"/api/clubs/{club}/calendar-feed", tok=t_plain)
    check("a club member reads the club feed URL", s == 200 and b.get("url") == club_url, (s, b))

    s, raw, ctype = call("GET", club_url, raw=True)
    ics = raw.decode("utf-8", "replace")
    flat = unfold(ics)
    check("club feed is served as text/calendar without sign-in", s == 200 and ctype.startswith("text/calendar"), (s, ctype))
    check("club feed lists the meeting", f"UID:row-meeting-{m1}" in flat and "SUMMARY:e2e weekly meeting\\, online\\; with notes" in flat, flat[:600])
    check("club feed carries the join link", f"URL:{link}" in flat and f"Join: {link}" in flat.replace("\\n", "\n"), flat[:900])
    check("feed lines are folded at 75 octets", all(len(line.encode()) <= 75 for line in ics.split("\r\n")),
          max(ics.split("\r\n"), key=lambda line: len(line.encode())))
    s, b, _ = call("POST", f"/api/clubs/{club}/calendar-feed", tok=t_admin)
    new_url = b.get("url") or ""
    check("reset issues a new URL", s == 200 and new_url and new_url != club_url, (s, b))
    check("the old URL stops working", call("GET", club_url, raw=True)[0] == 404)
    check("the new URL works", call("GET", new_url, raw=True)[0] == 200)
    check("an unknown token is 404", call("GET", f"/api/public/calendar/{fake_token}.ics", raw=True)[0] == 404)
    check("a malformed token is 404", call("GET", "/api/public/calendar/not-a-token.ics", raw=True)[0] == 404)

    # ── member calendar feed (for the app) ──
    s, b, _ = call("POST", "/api/mobile/calendar-feed", tok=t_plain)
    my_url = b.get("url") or ""
    check("a member gets a personal feed URL", s == 200 and my_url.endswith(".ics"), (s, b))
    s, raw, _ = call("GET", my_url, raw=True)
    flat = unfold(raw.decode("utf-8", "replace"))
    check("personal feed lists the club's meeting with its link", s == 200 and f"UID:row-meeting-{m1}" in flat and f"URL:{link}" in flat, flat[:600])
    check("personal feed URL reads back", call("GET", "/api/mobile/calendar-feed", tok=t_plain)[1].get("url") == my_url)

    # ── public pages never carry the link ──
    s, raw, _ = call("GET", f"/api/public/club/{club}/meetings", raw=True)
    check("the club website's meetings endpoint does not carry the link", link.encode() not in raw, (s, raw[:200]))

    # ── compliance: last month has one meeting with attendance and one without ──
    s1, _ = meeting("e2e held meeting", f"{last_month}-10T19:00:00", mode="in_person", url=None, members=[plain])
    s2, _ = meeting("e2e meeting without attendance", f"{last_month}-17T19:00:00", mode="in_person", url=None)
    check("two meetings recorded last month", s1 == 200 and s2 == 200, (s1, s2))
    s, b, _ = call("PUT", f"/api/districts/{district}/meeting-compliance/rule", {"meetingsPerMonth": 2}, t_admin)
    check("a club admin cannot set the district rule", s == 403, (s, b))
    s, b, _ = call("PUT", f"/api/districts/{district}/meeting-compliance/rule", {"meetingsPerMonth": 99}, t_sa)
    check("an out-of-range rule is refused", s == 400, (s, b))
    s, b, _ = call("PUT", f"/api/districts/{district}/meeting-compliance/rule", {"meetingsPerMonth": 2}, t_sa)
    check("the district sets 2 meetings a month", s == 204, (s, b))
    s, row = compliance(last_month)
    check("only the meeting with attendance counts, club flagged as missed",
          s == 200 and row.get("required") == 2 and row.get("held") == 1 and row.get("status") == "missed", (s, row))
    s, b, _ = call("PUT", f"/api/districts/{district}/meeting-compliance/rule", {"clubId": other, "meetingsPerMonth": 1}, t_sa)
    check("an override for a club of another district is refused", s == 404, (s, b))
    s, b, _ = call("PUT", f"/api/districts/{district}/meeting-compliance/rule", {"clubId": club, "meetingsPerMonth": 1}, t_sa)
    s, row = compliance(last_month)
    check("a club override of 1 makes the club compliant",
          s == 200 and row.get("required") == 1 and row.get("isOverride") is True and row.get("status") == "met", (s, row))
    s, row = compliance(this_month)
    check("the current month is 'due' until it is over", s == 200 and row.get("status") in ("due", "met"), (s, row))
    s, b, _ = call("GET", f"/api/clubs/{club}/meeting-compliance?month={last_month}", tok=t_plain)
    mine = (b.get("clubs") or [{}])[0] if s == 200 else b
    check("a club member reads the club's own status", s == 200 and mine.get("status") == "met" and mine.get("held") == 1, (s, b))
    s, b, _ = call("GET", f"/api/clubs/{other}/meeting-compliance", tok=t_plain)
    check("a member cannot read another club's status", s == 403, (s, b))
    s, b = compliance(last_month, t_plain)
    check("a plain member cannot read the district list", s == 403, (s, b))
    s, b, _ = call("GET", f"/api/districts/{district}/meeting-compliance?month=2026-13", tok=t_sa)
    check("a bad month is refused", s == 400, (s, b))
    s, b, _ = call("PUT", f"/api/districts/{district}/meeting-compliance/rule", {"clubId": club, "meetingsPerMonth": None}, t_sa)
    s, row = compliance(last_month)
    check("clearing the override returns to the district default", row.get("required") == 2 and row.get("isOverride") is False, row)

    check("switch off again", switch(False) == 204)
    check("off: the feed URL is closed again", call("GET", new_url, raw=True)[0] == 404)
finally:
    for mid in created:
        call("DELETE", f"{base}/{mid}", tok=t_admin)
    if created:
        ids = ",".join(str(i) for i in created)
        sql(f"DELETE FROM meeting_reminder_log WHERE fk_attendance_id IN ({ids})")
        for t in ("members", "anns", "annets", "visitors", "rotarians", "delegates"):
            sql(f"DELETE FROM club_attendance_{t} WHERE fk_attendance_id IN ({ids})")
        sql(f"DELETE FROM club_attendance WHERE pk_attendance_id IN ({ids})")
    sql(f"DELETE FROM meeting_calendar_feeds WHERE fk_club_id = {club} OR fk_member_id = {plain}")
    for line in filter(None, saved_feeds.splitlines()):
        tok_, c, m, by = line.split("\t")
        sql(f"INSERT INTO meeting_calendar_feeds (token, fk_club_id, fk_member_id, created_by) VALUES ('{tok_}', {c}, {m}, {by})")
    sql(f"DELETE FROM meeting_rules WHERE fk_district_id = {district} OR fk_club_id = {club}")
    for line in filter(None, saved_rules.splitlines()):
        d, c, n = line.split("\t")
        sql(f"INSERT INTO meeting_rules (fk_district_id, fk_club_id, MeetingsPerMonth) VALUES ({d}, {c}, {n})")
    switch(was_on)
    if not had_switch:
        sql("DELETE FROM platform_features WHERE feature_key = 'meetings'")

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

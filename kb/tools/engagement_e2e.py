"""Engagement (build list #26-#28): milestone messages once per member, PHF highlights, spotlight card approval.

    python -I kb/tools/engagement_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). Local copies only,
never production, and with no working email provider (the API run script points Brevo at a dead local URL): the
milestone pass attempts real members' emails, which must fail locally. Writes district settings, two designations,
engagement rows and email_log rows, and the engagement / membership_fields switches, and removes them all at the end;
audit_log rows stay (that table is append-only).
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request
from datetime import date

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    out = sql(q)
    if not out:
        sys.exit(f"setup query found nothing: {q}")
    return [int(x) if x.lstrip('-').isdigit() else x for x in out.splitlines()[0].split('\t')]


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 900}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def raw(method, path, tok, body=None):
    headers = {"Authorization": f"Bearer {tok}"}
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def call(method, path, tok, body=None):
    s, _, b = raw(method, path, tok, body)
    try:
        return s, json.loads(b) if b else None
    except ValueError:
        return s, b.decode(errors="replace")


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def feed(tok):
    s, b = call("GET", "/api/mobile/notifications?types=highlight&pageSize=100&days=365", tok)
    return [i for i in (b or {}).get("items", []) if i.get("type") == "highlight"] if s == 200 else None


# ── Who is who (real ids, picked by query) ──────────────────────────────────────────────────────────────────
CHAIN = ("JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND IFNULL(c.isdeleted,0)=0 AND c.IsActive=1 "
         "JOIN district_master dm ON dm.pk_district_id=c.fk_district_id AND dm.isdeleted=0 AND dm.IsActive=1 "
         "JOIN zone_master z ON z.pk_zone_id=dm.fk_zone_id AND z.isdeleted=0 AND z.IsActive=1 ")
YEARS = "TIMESTAMPDIFF(YEAR, cm.JoinedDate, CURDATE())"
# active members of club {c} with no role beyond Member
PLAIN = ("SELECT x.fk_member_master_profile_id FROM club_members x JOIN member_master_profile pm "
         "ON pm.pk_member_master_profile_id=x.fk_member_master_profile_id AND pm.isdeleted=0 "
         "WHERE x.fk_club_id={c} AND x.IsActive=1 AND IFNULL(x.isdeleted,0)=0 "
         "AND x.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM member_roles "
         "WHERE fk_role_id<>1 AND IsActive=1 AND IFNULL(isdeleted,0)=0) ORDER BY 1 LIMIT 1")
# a club admin of club {c} with no wider role (SuperAdmin, district admin, zone, ...)
ADMIN = ("SELECT r.fk_member_master_profile_id FROM member_roles r WHERE r.fk_club_id={c} AND r.fk_role_id=2 "
         "AND r.IsActive=1 AND IFNULL(r.isdeleted,0)=0 AND NOT EXISTS (SELECT 1 FROM member_roles y "
         "WHERE y.fk_member_master_profile_id=r.fk_member_master_profile_id AND y.IsActive=1 AND IFNULL(y.isdeleted,0)=0 "
         "AND (y.fk_role_id NOT IN (1,2) OR (y.fk_role_id=2 AND IFNULL(y.fk_club_id,0)=0))) ORDER BY 1 LIMIT 1")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND IFNULL(isdeleted,0)=0 LIMIT 1")[0]
# a member with an email whose join anniversary came round in the last 7 days, in a club with a plain admin and member
celebrant, club, district, years = one(
    f"SELECT cm.fk_member_master_profile_id, cm.fk_club_id, c.fk_district_id, {YEARS} FROM club_members cm {CHAIN}"
    "JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0 "
    f"WHERE cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND {YEARS} BETWEEN 1 AND 100 "
    f"AND DATE_ADD(cm.JoinedDate, INTERVAL {YEARS} YEAR) >= CURDATE() - INTERVAL 6 DAY AND IFNULL(m.EmailId,'')<>'' "
    f"AND EXISTS ({ADMIN.format(c='cm.fk_club_id')}) AND EXISTS ({PLAIN.format(c='cm.fk_club_id')}) "
    f"AND NOT EXISTS (SELECT 1 FROM engagement_events e WHERE e.dedupe_key=CONCAT('MILESTONE:', cm.fk_member_master_profile_id, ':', {YEARS})) "
    "ORDER BY 1 LIMIT 1")
admin = one(ADMIN.format(c=club))[0]
plain = one(PLAIN.format(c=club))[0]
other_club = one(f"SELECT c.pk_club_id FROM club_master c WHERE c.fk_district_id<>{district} AND IFNULL(c.isdeleted,0)=0 "
                 f"AND EXISTS ({PLAIN.format(c='c.pk_club_id')}) AND NOT EXISTS (SELECT 1 FROM member_roles q "
                 f"WHERE q.fk_member_master_profile_id={admin} AND q.fk_club_id=c.pk_club_id) ORDER BY 1 LIMIT 1")[0]
foreign = one(PLAIN.format(c=other_club))[0]
t_sa, t_admin, t_plain, t_foreign = token(sa, "SuperAdmin"), token(admin, "Admin"), token(plain, "Member"), token(foreign, "Member")
print(f"club {club}, district {district}, celebrant at {years} years")

flags_before = {k: sql(f"SELECT enabled FROM platform_features WHERE feature_key='{k}'") for k in ("engagement", "membership_fields")}
# base64 so any text survives the round trip through the mysql client
settings_before = sql("SELECT milestone_years, IFNULL(REPLACE(TO_BASE64(governor_message), '\\n', ''), '') "
                      f"FROM engagement_district_settings WHERE fk_district_id={district}")
event_mark = int(sql("SELECT IFNULL(MAX(pk_engagement_event_id),0) FROM engagement_events"))
email_mark = int(sql("SELECT IFNULL(MAX(pk_id),0) FROM email_log"))
designation_ids = []
NOTE = "e2e governor note"

try:
    # ── Feature flag ────────────────────────────────────────────────────────────────────────────────────────
    call("PUT", "/api/features/engagement", t_sa, {"enabled": False})
    s, _ = call("GET", f"/api/clubs/{club}/engagement/highlights", t_plain)
    check("flag off: highlights answer 404", s == 404, s)
    s, _ = call("PUT", "/api/features/engagement", t_sa, {"enabled": True})
    check("SuperAdmin switches engagement on", s in (200, 204), s)
    call("PUT", "/api/features/membership_fields", t_sa, {"enabled": True})

    # ── District settings ───────────────────────────────────────────────────────────────────────────────────
    base = f"/api/districts/{district}/engagement/settings"
    s, _ = call("GET", base, t_plain)
    check("a plain member cannot read the district settings (403)", s == 403, s)
    s, b = call("GET", base, t_sa)
    check("settings read", s == 200 and isinstance(b.get("milestoneYears"), list), (s, b))
    for name, body in [("year 0", {"milestoneYears": [0]}),
                       ("eleven milestones", {"milestoneYears": list(range(1, 12))}),
                       ("a Governor message over 2000 characters", {"milestoneYears": [1], "governorMessage": "x" * 2001})]:
        s, b = call("PUT", base, t_sa, body)
        check(f"validation refuses {name} (400)", s == 400, (s, b))
    s, _ = call("PUT", base, t_foreign, {"milestoneYears": [years]})
    check("another district's member cannot change the settings (403)", s == 403, s)
    s, _ = call("PUT", base, t_admin, {"milestoneYears": [years]})
    check("a club admin cannot change the district settings (403)", s == 403, s)
    s, b = call("PUT", base, t_sa, {"milestoneYears": [years, years],
                                    "governorMessage": f"Thank you, {{name}}, for {{years}} years with {{club}}. {NOTE}"})
    check("district settings saved (only this milestone, Governor message)",
          s == 200 and b["milestoneYears"] == [years], (s, b))

    # ── Milestone pass: once per member ─────────────────────────────────────────────────────────────────────
    s, _ = call("POST", f"/api/engagement/run?districtId={district}", t_plain)
    check("a plain member cannot run the pass (403)", s == 403, s)
    s, b = call("POST", f"/api/engagement/run?districtId={district}", t_sa)
    check("SuperAdmin runs the pass for the district", s == 200 and b["milestones"] >= 1, (s, b))
    key = f"MILESTONE:{celebrant}:{years}"
    events = sql(f"SELECT pk_engagement_event_id, card_status FROM engagement_events WHERE dedupe_key='{key}'").splitlines()
    check("one milestone row for the celebrant, card pending", len(events) == 1 and events[0].endswith("pending"), events)
    milestone_id = int(events[0].split('\t')[0]) if events else 0
    label = f"{years} {'year' if years == 1 else 'years'} in Rotary"
    mail_q = (f"FROM email_log WHERE pk_id>{email_mark} AND subject='Congratulations on {label}' AND recipient_email="
              f"(SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={celebrant})")
    check("one milestone email to the celebrant", sql(f"SELECT COUNT(*) {mail_q}") == "1", sql(f"SELECT COUNT(*) {mail_q}"))
    check("the email is the Governor variant (district template, signed)",
          sql(f"SELECT COUNT(*) {mail_q} AND body_html LIKE '%{NOTE}%' AND body_html LIKE '%District Governor, District%'") == "1")
    s, b = call("POST", f"/api/engagement/run?districtId={district}", t_sa)
    check("a second run sends nothing new", s == 200 and b["milestones"] == 0, (s, b))
    check("still one row and one email after the second run",
          sql(f"SELECT COUNT(*) FROM engagement_events WHERE dedupe_key='{key}'") == "1" and sql(f"SELECT COUNT(*) {mail_q}") == "1")

    items = feed(t_plain)
    check("the milestone shows in a club member's app feed",
          items is not None and any(i["id"] == milestone_id and label in i["title"] for i in items), items)
    s, b = call("GET", f"/api/clubs/{club}/engagement/highlights", t_plain)
    check("club members read the club's highlights", s == 200 and any(h["id"] == milestone_id and h["label"] == label for h in b), (s, b))
    s, _ = call("GET", f"/api/clubs/{club}/engagement/highlights", t_foreign)
    check("another club's member cannot read them (403)", s == 403, s)
    s, b = call("GET", f"/api/districts/{district}/engagement/highlights", t_sa)
    check("district highlights list it", s == 200 and any(h["id"] == milestone_id for h in b), (s, b))

    # ── PHF highlight ───────────────────────────────────────────────────────────────────────────────────────
    s, b = call("POST", f"/api/members/{plain}/foundation-designations", t_admin,
                {"type": "PHF", "level": 1, "awardedDate": date.today().isoformat()})
    check("club admin adds a PHF+1", s == 200 and b.get("id"), (s, b))
    if s == 200: designation_ids.append(b["id"])
    phf = sql(f"SELECT pk_engagement_event_id FROM engagement_events WHERE dedupe_key='PHF:{designation_ids[0]}'") if designation_ids else ""
    check("the new PHF becomes a highlight at once", phf.isdigit(), phf)
    phf_id = int(phf) if phf.isdigit() else 0
    s, b = call("POST", f"/api/members/{plain}/foundation-designations", t_admin, {"type": "PHF", "level": 2, "awardedDate": "2015-03-01"})
    if s == 200: designation_ids.append(b["id"])
    check("a back-filled PHF from 2015 is not news (no highlight)", s == 200 and sql(
        f"SELECT COUNT(*) FROM engagement_events WHERE dedupe_key='PHF:{b['id']}'") == "0", (s, b))
    items = feed(t_plain)
    check("the PHF shows in the app feed", items is not None and any(
        i["id"] == phf_id and "Paul Harris Fellow +1" in i["title"] for i in items), items)

    # ── Spotlight cards ─────────────────────────────────────────────────────────────────────────────────────
    s, b = call("GET", f"/api/clubs/{club}/engagement/cards?status=pending", t_admin)
    ids = {c["id"] for c in b} if s == 200 else set()
    check("club admin sees both cards pending", {milestone_id, phf_id} <= ids, (s, b))
    s, _ = call("GET", f"/api/clubs/{club}/engagement/cards", t_plain)
    check("a plain member cannot see the card queue (403)", s == 403, s)
    s, _ = call("GET", f"/api/clubs/{club}/engagement/cards?status=maybe", t_admin)
    check("an unknown status is refused (400)", s == 400, s)
    img = f"/api/engagement/spotlight-cards/{milestone_id}/image"
    s, h, png = raw("GET", img, t_admin)
    size = (int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")) if png[:4] == b"\x89PNG" else None
    check("card preview is a 1200x630 PNG", s == 200 and size == (1200, 630), (s, size))
    s, _, _ = raw("GET", img + "?download=true", t_admin)
    check("download is refused while the card is pending (409)", s == 409, s)
    s, _, _ = raw("GET", img, t_foreign)
    check("another club's member cannot see the card (403)", s == 403, s)
    s, _ = call("POST", f"/api/engagement/spotlight-cards/{milestone_id}/approve", t_plain)
    check("a plain member cannot approve (403)", s == 403, s)
    s, _ = call("POST", f"/api/engagement/spotlight-cards/{milestone_id}/approve", t_foreign)
    check("another club's member cannot approve (403)", s == 403, s)
    s, b = call("POST", f"/api/engagement/spotlight-cards/{milestone_id}/approve", t_admin)
    check("club admin approves the card", s == 200 and b["cardStatus"] == "approved", (s, b))
    check("the decision records who and when", sql(
        f"SELECT card_decided_by FROM engagement_events WHERE pk_engagement_event_id={milestone_id} AND card_decided_date IS NOT NULL") == str(admin))
    for _ in range(10):  # AuditMiddleware writes after the response has gone
        audited = sql(f"SELECT COUNT(*) FROM audit_log WHERE entity_type='Spotlight Card' AND action='Approve' AND entity_id={milestone_id}")
        if audited != "0": break
        time.sleep(0.3)
    check("the approval is in the audit log", audited != "0", audited)
    s, h, png = raw("GET", img + "?download=true", t_admin)
    check("approved card downloads as a PNG file", s == 200 and png[:4] == b"\x89PNG"
          and "attachment" in h.get("Content-Disposition", "") and f"spotlight-{milestone_id}.png" in h.get("Content-Disposition", ""),
          (s, h.get("Content-Disposition")))
    s, b = call("POST", f"/api/engagement/spotlight-cards/{phf_id}/reject", t_sa)
    check("SuperAdmin rejects the PHF card", s == 200 and b["cardStatus"] == "rejected", (s, b))
    s, b = call("GET", f"/api/districts/{district}/engagement/cards?status=rejected", t_sa)
    check("district queue lists the rejected card", s == 200 and any(c["id"] == phf_id for c in b), (s, b))
    s, _ = call("GET", f"/api/districts/{district}/engagement/cards", t_admin)
    check("a club admin cannot read the district queue (403)", s == 403, s)
    s, _ = call("POST", "/api/engagement/spotlight-cards/999999999/approve", t_sa)
    check("an unknown card is 404", s == 404, s)

    # ── Removing the designation removes the highlight ──────────────────────────────────────────────────────
    s, _ = call("DELETE", f"/api/members/{plain}/foundation-designations/{designation_ids[0]}", t_admin)
    s2, b = call("GET", f"/api/clubs/{club}/engagement/highlights", t_plain)
    items = feed(t_plain)
    check("a removed PHF leaves the highlights and the feed", s == 200 and s2 == 200
          and all(h["id"] != phf_id for h in b) and items is not None and all(i["id"] != phf_id for i in items), (s, s2))

    # ── Flag off hides the feed items ───────────────────────────────────────────────────────────────────────
    call("PUT", "/api/features/engagement", t_sa, {"enabled": False})
    items = feed(t_plain)
    check("flag off: no highlight items in the app feed", items == [], items)
finally:
    # ── Clean up ────────────────────────────────────────────────────────────────────────────────────────────
    sql(f"DELETE FROM engagement_events WHERE pk_engagement_event_id>{event_mark}")
    sql(f"DELETE FROM email_log WHERE pk_id>{email_mark} AND subject LIKE 'Congratulations on %'")
    if designation_ids:
        sql(f"DELETE FROM member_foundation_designations WHERE pk_member_designation_id IN ({','.join(map(str, designation_ids))})")
    if settings_before:
        y, m = (settings_before.split('\t') + [""])[:2]
        msg = f"FROM_BASE64('{m}')" if m else "NULL"
        sql(f"UPDATE engagement_district_settings SET milestone_years='{y}', governor_message={msg} WHERE fk_district_id={district}")
    else:
        sql(f"DELETE FROM engagement_district_settings WHERE fk_district_id={district}")
    for k, v in flags_before.items():
        sql(f"UPDATE platform_features SET enabled={v} WHERE feature_key='{k}'" if v else
            f"DELETE FROM platform_features WHERE feature_key='{k}'")
    left = sql(f"SELECT (SELECT COUNT(*) FROM engagement_events WHERE pk_engagement_event_id>{event_mark}) + "
               f"(SELECT COUNT(*) FROM email_log WHERE pk_id>{email_mark} AND subject LIKE 'Congratulations on %')")
    check("clean-up leaves no test rows", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAIL'}")
sys.exit(1 if fails else 0)

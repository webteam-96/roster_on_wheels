"""Escalation ladder (B.1 #32), target celebration (B.1 #35) and the Foundation giving link (Appendix B note), 2026-10-24.

    python -I kb/tools/escalation_celebration_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must run with the same JwtSettings__Secret). Local copies only, never
production, and with no working email provider (the API run script points Brevo at a dead local URL): alerts, the DG
note and milestone emails are attempted to real members' addresses and must fail locally. When ROW_E2E_GREETINGS_DLL
points at a built GreetingsWorker.dll, the worker's read-only dry run checks {{foundation_link}} in a birthday
template; without it that part prints SKIP. Test rows carry -24 in created_by / modified_by or 'E2E N24' in a text
column and are removed at the end, with the feature switches and settings put back; audit_log rows stay (append-only).
"""
import base64, hashlib, hmac, json, os, subprocess, sys, time, urllib.error, urllib.request
from datetime import date

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
WORKER = os.environ.get('ROW_E2E_GREETINGS_DLL', '')
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
M = -24  # created_by / modified_by of this script's rows
URL = "https://my.rotary.org/en/donate?e2e=n24"
FLAGS = ("escalation", "celebration", "meetings", "target_dashboard", "engagement", "communication")
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
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def raw(method, path, tok, body=None):
    headers = {"Authorization": f"Bearer {tok}"}
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
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


def feed(tok, kind):
    s, b = call("GET", f"/api/mobile/notifications?types={kind}&pageSize=100&days=365", tok)
    return [i for i in (b or {}).get("items", []) if i.get("type") == kind] if s == 200 else None


def esc(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")


# ── Who is who (real ids, picked by query) ──────────────────────────────────────────────────────────────────────
year, label = one("SELECT pk_year_id, YearLabel FROM rotary_year_master WHERE IsCurrent=1 AND isdeleted=0 LIMIT 1")
today = date.today()
last_month = date(today.year - (today.month == 1), (today.month - 2) % 12 + 1, 1)
LAST, THIS = last_month.strftime("%Y-%m"), today.strftime("%Y-%m")
CHAIN = ("JOIN club_master c ON c.pk_club_id={c} AND c.isdeleted=0 AND c.IsActive=1 "
         "JOIN district_master dm ON dm.pk_district_id=c.fk_district_id AND dm.isdeleted=0 AND dm.IsActive=1 "
         "JOIN zone_master z ON z.pk_zone_id=dm.fk_zone_id AND z.isdeleted=0 AND z.IsActive=1 ")
# EscalationService level 1: the current year's Club President, newest board row first
PRESIDENT = ("SELECT m.pk_member_master_profile_id FROM board_of_directors b "
             "JOIN designation_master dd ON dd.pk_designation_id=b.fk_designation_id AND dd.designation_name='Club President' "
             "JOIN rotary_year_master y ON y.pk_year_id=b.fk_year_id AND y.IsCurrent=1 AND y.isdeleted=0 "
             "JOIN member_master_profile m ON m.pk_member_master_profile_id=b.fk_member_master_profile_id AND m.isdeleted=0 "
             "WHERE b.fk_club_id={c} AND b.isdeleted=0 ORDER BY b.pk_board_director_id DESC LIMIT 1")
NO_ROLES = "NOT IN (SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id<>1 AND IsActive=1 AND IFNULL(isdeleted,0)=0)"
ACTIVE = "cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND cm.IsHonoraryMember=0"
# Club C: its president has an email and is an active member; the district has no escalation rules, DG, meeting rules or
# District Dues this year; C has no AG, no growth target and no meeting with attendance last month.
club, district = one(f"""SELECT b.fk_club_id, c.fk_district_id FROM board_of_directors b
    JOIN designation_master dd ON dd.pk_designation_id=b.fk_designation_id AND dd.designation_name='Club President'
    JOIN rotary_year_master y ON y.pk_year_id=b.fk_year_id AND y.IsCurrent=1 AND y.isdeleted=0
    JOIN member_master_profile m ON m.pk_member_master_profile_id=b.fk_member_master_profile_id AND m.isdeleted=0 AND IFNULL(m.EmailId,'')<>''
    {CHAIN.format(c='b.fk_club_id')}
    JOIN club_members cm ON cm.fk_club_id=b.fk_club_id AND cm.fk_member_master_profile_id=m.pk_member_master_profile_id AND {ACTIVE}
    WHERE b.isdeleted=0
      AND NOT EXISTS (SELECT 1 FROM escalation_rules r WHERE r.fk_district_id=c.fk_district_id)
      AND NOT EXISTS (SELECT 1 FROM district_governors g WHERE g.fk_district_id=c.fk_district_id AND g.fk_year_id={year})
      AND NOT EXISTS (SELECT 1 FROM meeting_rules mr WHERE mr.fk_district_id=c.fk_district_id)
      AND NOT EXISTS (SELECT 1 FROM meeting_rules mr JOIN club_master x ON x.pk_club_id=mr.fk_club_id WHERE x.fk_district_id=c.fk_district_id)
      AND NOT EXISTS (SELECT 1 FROM club_dues d WHERE d.fk_district_id=c.fk_district_id AND d.RotaryYear='{label}')
      AND NOT EXISTS (SELECT 1 FROM district_ag a WHERE a.fk_club_id=b.fk_club_id AND a.fk_year_id={year})
      AND NOT EXISTS (SELECT 1 FROM club_growth_targets t WHERE t.fk_club_id=b.fk_club_id AND t.fk_year_id={year})
      AND NOT EXISTS (SELECT 1 FROM club_attendance a WHERE a.fk_club_id=b.fk_club_id AND a.isdeleted=0
                      AND a.EventDateTime >= '{last_month}' AND a.EventDateTime < '{today.replace(day=1)}')
      AND (SELECT COUNT(*) FROM club_members x WHERE x.fk_club_id=b.fk_club_id AND x.IsActive=1 AND IFNULL(x.isdeleted,0)=0
           AND x.IsHonoraryMember=0) >= 2
      AND (SELECT COUNT(DISTINCT x.fk_member_master_profile_id) FROM club_members x
           JOIN club_master xc ON xc.pk_club_id=x.fk_club_id AND xc.isdeleted=0 AND xc.IsActive=1
           JOIN member_master_profile xm ON xm.pk_member_master_profile_id=x.fk_member_master_profile_id AND xm.isdeleted=0
           WHERE xc.fk_district_id=c.fk_district_id AND xc.pk_club_id<>b.fk_club_id AND x.IsActive=1 AND IFNULL(x.isdeleted,0)=0
             AND x.IsHonoraryMember=0 AND IFNULL(xm.EmailId,'')<>'' AND x.fk_member_master_profile_id {NO_ROLES}) >= 6
    ORDER BY b.fk_club_id LIMIT 1""")
president = one(PRESIDENT.format(c=club))[0]
if not sql(f"SELECT IFNULL(EmailId,'') FROM member_master_profile WHERE pk_member_master_profile_id={president}"):
    sys.exit(f"setup: the president the API picks for club {club} has no email")
club_name = sql(f"SELECT ClubName FROM club_master WHERE pk_club_id={club}")
roster = [int(x) for x in sql(f"SELECT cm.fk_member_master_profile_id FROM club_members cm WHERE cm.fk_club_id={club} AND {ACTIVE} "
                              "ORDER BY 1 LIMIT 3").split()]
# Plain members of other clubs of the district, without roles: a member, the AG, the DG and the district admin.
others = [int(x) for x in sql(f"""SELECT DISTINCT cm.fk_member_master_profile_id FROM club_members cm
    JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND c.isdeleted=0 AND c.IsActive=1
    JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0 AND IFNULL(m.EmailId,'')<>''
    WHERE c.fk_district_id={district} AND c.pk_club_id<>{club} AND {ACTIVE} AND cm.fk_member_master_profile_id {NO_ROLES}
      AND cm.fk_member_master_profile_id NOT IN (SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id={club})
    ORDER BY 1 LIMIT 4""").split()]
plain, ag, dg, dadmin = others
other_district, other_admin = one(f"""SELECT c.fk_district_id, cm.fk_member_master_profile_id FROM club_members cm
    JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND c.isdeleted=0 AND c.IsActive=1
    WHERE c.fk_district_id<>{district} AND {ACTIVE} AND cm.fk_member_master_profile_id {NO_ROLES}
      AND cm.fk_member_master_profile_id NOT IN (SELECT x.fk_member_master_profile_id FROM club_members x
          JOIN club_master y ON y.pk_club_id=x.fk_club_id WHERE y.fk_district_id={district})
    ORDER BY 1 LIMIT 1""")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND IFNULL(isdeleted,0)=0 LIMIT 1")[0]
email_of = lambda m: sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id={m}")
name_of = lambda m: sql(f"SELECT MemberName FROM member_master_profile WHERE pk_member_master_profile_id={m}")
# The milestone celebrant (as engagement_e2e): a join anniversary in the last 7 days, an email, a club in another district.
YEARS = "TIMESTAMPDIFF(YEAR, cm.JoinedDate, CURDATE())"
celebrant, district2, years = one(
    f"SELECT cm.fk_member_master_profile_id, c.fk_district_id, {YEARS} FROM club_members cm {CHAIN.format(c='cm.fk_club_id')}"
    "JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0 "
    f"WHERE cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND {YEARS} BETWEEN 1 AND 100 AND c.fk_district_id<>{district} "
    f"AND DATE_ADD(cm.JoinedDate, INTERVAL {YEARS} YEAR) >= CURDATE() - INTERVAL 6 DAY AND IFNULL(m.EmailId,'')<>'' "
    f"AND NOT EXISTS (SELECT 1 FROM engagement_events e WHERE e.dedupe_key=CONCAT('MILESTONE:', cm.fk_member_master_profile_id, ':', {YEARS})) "
    "ORDER BY 1 LIMIT 1")
t = {k: token(v, r) for k, v, r in [("sa", sa, "SuperAdmin"), ("dadmin", dadmin, "Admin"), ("plain", plain, "Member"),
                                     ("president", president, "Member"), ("ag", ag, "Member"), ("dg", dg, "Member"),
                                     ("other", other_admin, "Admin")]}
print(f"district {district} club {club} (president {president}), AG {ag}, DG {dg}, district admin {dadmin}, "
      f"member {plain}, other district {other_district}; milestone district {district2}; periods {LAST} / {THIS}")

flags_before = {k: sql(f"SELECT enabled FROM platform_features WHERE feature_key='{k}'") for k in FLAGS}
alert_mark = int(sql("SELECT IFNULL(MAX(pk_alert_id),0) FROM escalation_alerts"))
event_mark = int(sql("SELECT IFNULL(MAX(pk_engagement_event_id),0) FROM engagement_events"))
email_mark = int(sql("SELECT IFNULL(MAX(pk_id),0) FROM email_log"))
audit_mark = int(sql("SELECT IFNULL(MAX(pk_audit_id),0) FROM audit_log"))
comm_before = {}  # district -> its foundation_giving_url before the test, or None when it had no settings row


def keep_comm(d):
    if d not in comm_before:
        had = sql(f"SELECT COUNT(*) FROM comm_settings WHERE fk_club_id=0 AND fk_district_id={d}") == "1"
        comm_before[d] = sql(f"SELECT IFNULL(foundation_giving_url,'') FROM comm_settings WHERE fk_club_id=0 "
                             f"AND fk_district_id={d}") if had else None


keep_comm(district)
keep_comm(district2)
club_comm_before = sql(f"SELECT COUNT(*) FROM comm_settings WHERE fk_club_id={club} AND fk_district_id=0") == "1"
eng_before = sql("SELECT milestone_years, IFNULL(REPLACE(TO_BASE64(governor_message), '\\n', ''), '') "
                 f"FROM engagement_district_settings WHERE fk_district_id={district2}")
worker_club, worker_flags = None, None


def set_flag(k, on):
    return call("PUT", f"/api/features/{k}", t["sa"], {"enabled": on})[0]


def alerts(rule):
    """[(level, member, status, period, reason, id)] of club C for the rule, written by this run."""
    out = sql(f"SELECT level, IFNULL(fk_member_id,0), email_status, period, reason, pk_alert_id FROM escalation_alerts "
              f"WHERE fk_club_id={club} AND rule_key='{rule}' AND pk_alert_id>{alert_mark} ORDER BY level")
    return [tuple(int(x) if x.isdigit() else x for x in r.split('\t')) for r in out.splitlines()] if out else []


def backdate(rule, level, days):
    sql(f"UPDATE escalation_alerts SET created_date = created_date - INTERVAL {days} DAY "
        f"WHERE fk_club_id={club} AND rule_key='{rule}' AND level={level} AND pk_alert_id>{alert_mark}")


def run():
    s, b = call("POST", f"/api/escalation/run?districtId={district}", t["sa"])
    return b.get("alerts") if s == 200 and isinstance(b, dict) else (s, b)


def mails(subject, to):
    return int(sql(f"SELECT COUNT(*) FROM email_log WHERE pk_id>{email_mark} AND subject='{esc(subject)}' "
                   f"AND recipient_email='{esc(email_of(to))}'"))


try:
    # ── Switches ────────────────────────────────────────────────────────────────────────────────────────────────
    S = f"/api/districts/{district}/escalation/settings"
    set_flag("escalation", False)
    s, _ = call("GET", S, t["sa"])
    check("escalation off: settings answer 404", s == 404, s)
    s, _ = call("POST", f"/api/escalation/run?districtId={district}", t["sa"])
    check("escalation off: the run answers 404", s == 404, s)
    check("SuperAdmin switches escalation on", set_flag("escalation", True) == 204)
    for k in ("meetings", "target_dashboard"):
        set_flag(k, True)

    # ── Test people and data ────────────────────────────────────────────────────────────────────────────────────
    sql(f"INSERT INTO member_roles (fk_member_master_profile_id, fk_role_id, fk_club_id, fk_district_id, IsActive, isdeleted, created_by) "
        f"VALUES ({dadmin},2,NULL,{district},1,0,{M}),({other_admin},2,NULL,{other_district},1,0,{M})")
    sql(f"INSERT INTO district_ag (fk_district_id, fk_member_id, fk_club_id, fk_year_id, is_active, isdeleted, created_by) "
        f"VALUES ({district},{ag},{club},{year},1,0,{M})")
    sql(f"INSERT INTO district_governors (fk_district_id, fk_year_id, fk_member_id, member_name, created_by) "
        f"SELECT {district},{year},{dg},MemberName,{M} FROM member_master_profile WHERE pk_member_master_profile_id={dg}")
    # every other club of the district needs 0 meetings a month, club C 2: only C misses last month
    sql(f"INSERT INTO meeting_rules (fk_district_id, MeetingsPerMonth, modified_by) VALUES ({district},0,{M})")
    sql(f"INSERT INTO meeting_rules (fk_club_id, MeetingsPerMonth, modified_by) VALUES ({club},2,{M})")

    # ── Access and validation ───────────────────────────────────────────────────────────────────────────────────
    for who in ("plain", "president", "other"):
        s, _ = call("GET", S, t[who])
        check(f"{who}: cannot read the district's escalation rules (403)", s == 403, s)
        s, _ = call("PUT", S, t[who], {"meetingShortfall": 1, "agDelayDays": 3, "dgDelayDays": 2})
        check(f"{who}: cannot change them (403)", s == 403, s)
    s, b = call("GET", S, t["dadmin"])
    check("district admin reads the rules: both off by default, 7-day delays",
          s == 200 and b["targetStatus"] is None and b["meetingShortfall"] is None and b["agDelayDays"] == 7
          and b["dgDelayDays"] == 7 and b["targetRuleActive"] and b["meetingRuleActive"], (s, b))
    for name, body in [("an unknown target status", {"targetStatus": "purple", "agDelayDays": 3, "dgDelayDays": 2}),
                       ("0 meetings missed", {"meetingShortfall": 0, "agDelayDays": 3, "dgDelayDays": 2}),
                       ("32 meetings missed", {"meetingShortfall": 32, "agDelayDays": 3, "dgDelayDays": 2}),
                       ("a 0-day delay", {"meetingShortfall": 1, "agDelayDays": 0, "dgDelayDays": 2}),
                       ("a 61-day delay", {"meetingShortfall": 1, "agDelayDays": 3, "dgDelayDays": 61})]:
        s, b = call("PUT", S, t["dadmin"], body)
        check(f"validation refuses {name} (400)", s == 400, (s, b))
    for who in ("dadmin", "plain"):
        s, _ = call("POST", f"/api/escalation/run?districtId={district}", t[who])
        check(f"{who}: cannot run the pass (403)", s == 403, s)

    # ── Meeting rule: threshold, level 1, idempotency ───────────────────────────────────────────────────────────
    s, b = call("PUT", S, t["dadmin"], {"meetingShortfall": 3, "agDelayDays": 3, "dgDelayDays": 2})
    check("district admin saves a meeting rule of 3 missed meetings", s == 200 and b["meetingShortfall"] == 3, (s, b))
    for _ in range(10):  # AuditMiddleware writes after the response has gone
        audited = sql(f"SELECT COUNT(*) FROM audit_log WHERE pk_audit_id>{audit_mark} AND entity_type='Escalation' "
                      f"AND action='Update' AND fk_member_master_profile_id={dadmin}")
        if audited != "0": break
        time.sleep(0.3)
    check("the rule change is in the audit log", audited != "0", audited)
    run()
    check("threshold: a club 2 meetings short does not fire a rule of 3", alerts("meetings") == [], alerts("meetings"))
    call("PUT", S, t["dadmin"], {"meetingShortfall": 2, "agDelayDays": 3, "dgDelayDays": 2})
    n = run()
    a = alerts("meetings")
    check("a rule of 2: one alert, level 1, to the club president, for last month",
          n == 1 and len(a) == 1 and a[0][:4] == (1, president, "sent", LAST), (n, a))
    month = last_month.strftime("%B %Y")
    check("the alert says why", bool(a) and a[0][4] == f"0 of 2 required meetings held in {month}.", a)
    subject = f"{club_name} held fewer meetings than the district's rule"
    check("one email to the club president", mails(subject, president) == 1, mails(subject, president))
    check("a second run sends nothing", run() == 0 and len(alerts("meetings")) == 1 and mails(subject, president) == 1)
    items = feed(t["president"], "escalation")
    check("the president sees the alert in the app", items is not None and any(
        i["id"] == a[0][5] and i["title"] == subject and i["body"] == a[0][4] for i in items), items)
    check("other members do not", feed(t["plain"], "escalation") == [], feed(t["plain"], "escalation"))

    # ── Ladder timing ───────────────────────────────────────────────────────────────────────────────────────────
    backdate("meetings", 1, 2)
    check("2 days after level 1 (AG delay 3): no level 2 yet", run() == 0 and len(alerts("meetings")) == 1, alerts("meetings"))
    backdate("meetings", 1, 1)
    n = run()
    a = alerts("meetings")
    check("3 days after: level 2 to the Assistant Governor", n == 1 and len(a) == 2 and a[1][:3] == (2, ag, "sent"), (n, a))
    check("one email to the AG", mails(subject, ag) == 1, mails(subject, ag))
    check("the AG sees it in the app", any(i["id"] == a[1][5] for i in feed(t["ag"], "escalation") or []))
    check("a rerun does not repeat level 2", run() == 0 and len(alerts("meetings")) == 2)
    backdate("meetings", 2, 1)
    check("1 day after level 2 (DG delay 2): no level 3 yet", run() == 0 and len(alerts("meetings")) == 2)
    backdate("meetings", 2, 1)
    n = run()
    a = alerts("meetings")
    check("2 days after: level 3 to the District Governor", n == 1 and len(a) == 3 and a[2][:3] == (3, dg, "sent"), (n, a))
    check("one email to the DG", mails(subject, dg) == 1, mails(subject, dg))
    backdate("meetings", 3, 30)
    check("level 3 is the top of the ladder", run() == 0 and len(alerts("meetings")) == 3)

    # ── The log view ────────────────────────────────────────────────────────────────────────────────────────────
    L = f"/api/districts/{district}/escalation/alerts"
    s, b = call("GET", L + f"?clubId={club}", t["dadmin"])
    mine = sorted((r for r in b if r["clubId"] == club and r["rule"] == "meetings"), key=lambda r: -r["level"]) if s == 200 else []
    check("the log lists the three levels with who, when, why and level",
          [(r["level"], r["role"], r["memberId"], r["recipientName"], r["emailStatus"]) for r in mine] ==
          [(3, "District Governor", dg, name_of(dg), "sent"), (2, "Assistant Governor", ag, name_of(ag), "sent"),
           (1, "Club president", president, name_of(president), "sent")]
          and all(r["reason"] == a[0][4] and r["createdDate"] and r["period"] == LAST for r in mine), (s, mine))
    check("the log is newest first", s == 200 and [r["createdDate"] for r in b] == sorted((r["createdDate"] for r in b), reverse=True))
    s, b = call("GET", L + "?rule=target", t["dadmin"])
    check("the log filters by rule", s == 200 and all(r["rule"] == "target" for r in b), (s, b))
    s, _ = call("GET", L + "?rule=bogus", t["dadmin"])
    check("an unknown rule is refused (400)", s == 400, s)
    for who in ("plain", "president", "ag", "other"):
        s, _ = call("GET", L, t[who])
        check(f"{who}: cannot read the log (403)", s == 403, s)

    # ── Target rule: nobody in the role, a club that catches up stops climbing ──────────────────────────────────
    sql(f"INSERT INTO club_growth_targets (fk_club_id, fk_year_id, target_net_growth, modified_by) VALUES ({club},{year},50,{M})")
    s, b = call("PUT", S, t["dadmin"], {"targetStatus": "RED", "meetingShortfall": 2, "agDelayDays": 3, "dgDelayDays": 2})
    check("district admin adds the target rule (red)", s == 200 and b["targetStatus"] == "red", (s, b))
    run()
    a = alerts("target")
    check("a club far behind its growth target alerts its president for this month",
          len(a) == 1 and a[0][:4] == (1, president, "sent", THIS) and "membership growth" in a[0][4] and "of 50" in a[0][4], a)
    sql(f"UPDATE district_ag SET is_active=0 WHERE created_by={M}")
    backdate("target", 1, 3)
    run()
    a = alerts("target")
    check("no Assistant Governor: level 2 is still logged, with nobody to receive it",
          len(a) == 2 and a[1][:3] == (2, 0, "no_recipient"), a)
    sql(f"UPDATE district_ag SET is_active=1 WHERE created_by={M}")
    sql(f"DELETE FROM club_growth_targets WHERE modified_by={M}")
    backdate("target", 2, 2)
    run()
    check("the club no longer misses the target: no level 3", len(alerts("target")) == 2, alerts("target"))
    set_flag("target_dashboard", False)
    s, b = call("GET", S, t["dadmin"])
    check("settings show the target rule waiting for the target dashboard", s == 200 and b["targetRuleActive"] is False, (s, b))

    # ── Target celebration ──────────────────────────────────────────────────────────────────────────────────────
    set_flag("celebration", False)
    s, _ = call("POST", f"/api/celebration/run?districtId={district}", t["sa"])
    check("celebration off: the run answers 404", s == 404, s)
    check("SuperAdmin switches celebration on", set_flag("celebration", True) == 204)
    set_flag("engagement", True)
    for who in ("dadmin", "plain"):
        s, _ = call("POST", f"/api/celebration/run?districtId={district}", t[who])
        check(f"{who}: cannot run the celebration pass (403)", s == 403, s)
    dues = int(sql(f"INSERT INTO club_dues (fk_district_id, RotaryYear, Purpose, created_by) VALUES "
                   f"({district},'{label}','E2E N24 dues',{M}); SELECT LAST_INSERT_ID();"))
    sql("INSERT INTO club_dues_members (fk_club_dues_id, fk_club_id, fk_member_profile_id, IsHonorary, Rate, IsPaid) VALUES "
        f"({dues},{club},{roster[0]},0,10,1),({dues},{club},{roster[1]},0,10,1)")
    celebrate = lambda: call("POST", f"/api/celebration/run?districtId={district}", t["sa"])
    s, b = celebrate()
    key = f"TARGET:{club}:{year}:dues:2"
    row = sql(f"SELECT pk_engagement_event_id, card_status, IFNULL(fk_member_master_profile_id,0), target_key, level "
              f"FROM engagement_events WHERE dedupe_key='{key}'").split('\t')
    check("all District Dues paid: one celebration", s == 200 and b["celebrations"] == 1 and row[1:] == ["pending", "0", "dues", "2"], (s, b, row))
    cid = int(row[0]) if row[0].isdigit() else 0
    note = f"{club_name} reached its District Dues target"
    check("a note to the District Governor", mails(note, dg) == 1, mails(note, dg))
    s, b = celebrate()
    check("once per target: a second run celebrates nothing", s == 200 and b["celebrations"] == 0
          and sql(f"SELECT COUNT(*) FROM engagement_events WHERE dedupe_key='{key}'") == "1" and mails(note, dg) == 1, (s, b))
    items = feed(t["president"], "celebration")
    check("the club's members see it in the app", items is not None and any(
        i["id"] == cid and i["title"] == "District Dues target reached" and f"{club_name} reached its District Dues target of 2." == i["body"]
        for i in items), items)
    check("members of other clubs do not", all(i["id"] != cid for i in feed(t["ag"], "celebration") or []))
    s, b = call("GET", f"/api/districts/{district}/engagement/cards?status=pending", t["dadmin"])
    card = next((c for c in b if c["id"] == cid), None) if s == 200 else None
    check("the spotlight card waits in the district's queue, with the club in place of a member",
          card is not None and card["memberName"] == club_name and card["memberId"] is None and card["type"] == "TARGET"
          and card["label"] == "District Dues target reached", (s, card))
    s, h, png = raw("GET", f"/api/engagement/spotlight-cards/{cid}/image", t["dadmin"])
    size = (int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")) if png[:4] == b"\x89PNG" else None
    check("card preview is a 1200x630 PNG", s == 200 and size == (1200, 630), (s, size))
    s, b = call("POST", f"/api/engagement/spotlight-cards/{cid}/approve", t["dadmin"])
    check("district admin approves the card", s == 200 and b["cardStatus"] == "approved", (s, b))
    s, _ = call("GET", f"/api/clubs/{club}/engagement/highlights", t["president"])
    check("club highlights still load with the club's celebration in them", s == 200, s)
    sql(f"INSERT INTO club_dues_members (fk_club_dues_id, fk_club_id, fk_member_profile_id, IsHonorary, Rate, IsPaid) VALUES "
        f"({dues},{club},{roster[2] if len(roster) > 2 else plain},0,10,0)")
    s, b = celebrate()
    check("a raised target (3 on the roster, 2 paid) is not reached", s == 200 and b["celebrations"] == 0, (s, b))
    sql(f"UPDATE club_dues_members SET IsPaid=1 WHERE fk_club_dues_id={dues}")
    s, b = celebrate()
    check("reaching the raised target celebrates once more", s == 200 and b["celebrations"] == 1 and sql(
        f"SELECT COUNT(*) FROM engagement_events WHERE dedupe_key='TARGET:{club}:{year}:dues:3'") == "1", (s, b))
    set_flag("celebration", False)
    check("celebration off: no celebration items in the app", feed(t["president"], "celebration") == [])

    # ── Foundation giving link: the district setting ────────────────────────────────────────────────────────────
    set_flag("communication", True)
    C = f"/api/districts/{district}/comms/settings"
    s, base = call("GET", C, t["dadmin"])
    check("district admin reads the email settings", s == 200 and "foundationGivingUrl" in base, (s, base))
    for bad in ["http://example.org/give", "javascript:alert(1)", "https://example.org/a b", "/give",
                "https://user:secret@example.org/give", "https://example.org/" + "a" * 490]:
        s, b = call("PUT", C, t["dadmin"], {**base, "foundationGivingUrl": bad})
        check(f"the link {bad[:40]!r} is refused (400)", s == 400, (s, b))
    for who in ("plain", "other"):
        s, _ = call("PUT", C, t[who], {**base, "foundationGivingUrl": URL})
        check(f"{who}: cannot set the district's link (403)", s == 403, s)
    s, b = call("PUT", C, t["dadmin"], {**base, "foundationGivingUrl": URL})
    check("district admin saves the link", s == 200 and b["foundationGivingUrl"] == URL, (s, b))
    s, b = call("PUT", f"/api/clubs/{club}/comms/settings", t["sa"], {"foundationGivingUrl": URL})
    check("a club cannot hold its own link (its district's is used)", s == 200 and b["foundationGivingUrl"] is None, (s, b))

    # ── {foundation_link} in the N9 milestone texts ─────────────────────────────────────────────────────────────
    C2 = f"/api/districts/{district2}/comms/settings"
    E2 = f"/api/districts/{district2}/engagement/settings"
    s, base2 = call("GET", C2, t["sa"])
    call("PUT", C2, t["sa"], {**base2, "foundationGivingUrl": URL})
    label_m = f"{years} {'year' if years == 1 else 'years'} in Rotary"
    mail_q = (f"FROM email_log WHERE pk_id>{email_mark} AND subject='Congratulations on {label_m}' AND recipient_email='{esc(email_of(celebrant))}'")

    def milestone(message):
        sql(f"DELETE FROM engagement_events WHERE dedupe_key='MILESTONE:{celebrant}:{years}'")
        call("PUT", E2, t["sa"], {"milestoneYears": [years], "governorMessage": message})
        s, b = call("POST", f"/api/engagement/run?districtId={district2}", t["sa"])
        return s == 200 and b["milestones"] >= 1 and sql(f"SELECT COUNT(*) {mail_q}") != "0"

    ok = milestone("Thank you, {name}. Give: {foundation_link} E2E N24")
    check("the Governor message fills {foundation_link} with the district's link",
          ok and sql(f"SELECT COUNT(*) {mail_q} AND body_html LIKE '%Give: {URL} E2E N24%'") == "1")
    ok = milestone(None)
    check("the standard milestone text adds the link when the district has one",
          ok and sql(f"SELECT COUNT(*) {mail_q} AND body_html LIKE '%Celebrate with a gift to The Rotary Foundation%{URL}%'") == "1")
    call("PUT", C2, t["sa"], {**base2, "foundationGivingUrl": ""})
    before = int(sql(f"SELECT COUNT(*) {mail_q}"))
    ok = milestone(None)
    newest = sql(f"SELECT body_html {mail_q} ORDER BY pk_id DESC LIMIT 1")
    check("no link set: no link line in the milestone email",
          ok and int(sql(f"SELECT COUNT(*) {mail_q}")) == before + 1 and "Celebrate with a gift" not in newest and "e2e=n24" not in newest)

    # ── {{foundation_link}} in a birthday template (GreetingsWorker dry run) ────────────────────────────────────
    if not WORKER or not os.path.isfile(WORKER):
        print("SKIP greetings worker dry run: set ROW_E2E_GREETINGS_DLL to a built GreetingsWorker.dll")
    else:
        # a member with a birthday and an email, in a club whose name is unique (the worker filters by name)
        worker_club, worker_district, birthday = one(
            f"SELECT cm.fk_club_id, c.fk_district_id, DATE_FORMAT(m.BirthDate, '%Y-%m-%d') FROM club_members cm {CHAIN.format(c='cm.fk_club_id')}"
            "JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0 "
            f"WHERE {ACTIVE} AND YEAR(m.BirthDate) > 1900 AND IFNULL(m.EmailId,'')<>'' "
            "AND (SELECT COUNT(*) FROM club_master n WHERE n.ClubName=c.ClubName) = 1 ORDER BY 1 LIMIT 1")
        keep_comm(worker_district)
        CW = f"/api/districts/{worker_district}/comms/settings"
        s, basew = call("GET", CW, t["sa"])
        worker_flags = sql(f"SELECT IsEnableBirthdayEmail, IFNULL(GreetingReviewedYearId,'NULL') FROM club_master WHERE pk_club_id={worker_club}").split('\t')
        sql(f"UPDATE club_master SET IsEnableBirthdayEmail=1, GreetingReviewedYearId={year} WHERE pk_club_id={worker_club}")
        s, cs = call("GET", f"/api/clubs/{worker_club}/comms/settings", t["sa"])
        sql("INSERT INTO comm_templates (fk_club_id, fk_district_id, template_key, language, subject, body_html, reviewed, modified_by) "
            f"VALUES ({worker_club},0,'birthday','{cs['effectiveLanguage']}','E2E N24 {{{{foundation_link}}}}','<p>{{{{foundation_link}}}}</p>',1,{M})")
        env = {**os.environ, "ConnectionStrings__DefaultConnection": f"Server=127.0.0.1;Port={PORT};Database={DB};User Id=root;Password=;",
               "Brevo__ApiKey": "e2e-dummy", "Brevo__ApiUrl": "http://127.0.0.1:9/v3/smtp/email", "Greetings__DeductCredits": "false"}
        name = sql(f"SELECT ClubName FROM club_master WHERE pk_club_id={worker_club}")

        def dry():
            r = subprocess.run(["dotnet", WORKER, "--dry-run", "--club-name", name, "--date", birthday],
                               capture_output=True, text=True, env=env, timeout=300)
            return r.stdout

        call("PUT", CW, t["sa"], {**basew, "foundationGivingUrl": URL})
        check("a club birthday template fills {{foundation_link}} with its district's link", f"[subject=E2E N24 {URL}]" in dry())
        call("PUT", CW, t["sa"], {**basew, "foundationGivingUrl": ""})
        out = dry()
        check("no link set: {{foundation_link}} is empty", "[subject=E2E N24 ]" in out and "e2e=n24" not in out)
finally:
    # ── Clean up ────────────────────────────────────────────────────────────────────────────────────────────────
    steps = [
        f"DELETE FROM escalation_alerts WHERE pk_alert_id>{alert_mark}",
        f"DELETE FROM escalation_rules WHERE fk_district_id={district}",
        f"DELETE FROM meeting_rules WHERE modified_by={M}",
        f"DELETE FROM club_growth_targets WHERE modified_by={M}",
        f"DELETE m FROM club_dues_members m JOIN club_dues d ON d.pk_club_dues_id=m.fk_club_dues_id WHERE d.created_by={M}",
        f"DELETE FROM club_dues WHERE created_by={M}",
        f"DELETE FROM district_ag WHERE created_by={M}",
        f"DELETE FROM district_governors WHERE created_by={M}",
        f"DELETE FROM member_roles WHERE created_by={M}",
        f"DELETE FROM engagement_events WHERE pk_engagement_event_id>{event_mark}",
        f"DELETE FROM email_log WHERE pk_id>{email_mark} AND (subject LIKE '% held fewer meetings than the district''s rule' "
        "OR subject LIKE '% is behind its targets' OR subject LIKE '% reached its % target' OR subject LIKE 'Congratulations on %')",
        f"DELETE FROM comm_templates WHERE modified_by={M}",
    ]
    for d, before in comm_before.items():
        steps.append(f"DELETE FROM comm_settings WHERE fk_club_id=0 AND fk_district_id={d}" if before is None else
                     f"UPDATE comm_settings SET foundation_giving_url=NULLIF('{esc(before)}','') WHERE fk_club_id=0 AND fk_district_id={d}")
    if not club_comm_before:
        steps.append(f"DELETE FROM comm_settings WHERE fk_club_id={club} AND fk_district_id=0")
    if eng_before:
        y, msg = (eng_before.split('\t') + [""])[:2]
        msg_sql = f"FROM_BASE64('{msg}')" if msg else "NULL"
        steps.append(f"UPDATE engagement_district_settings SET milestone_years='{y}', governor_message={msg_sql} "
                     f"WHERE fk_district_id={district2}")
    else:
        steps.append(f"DELETE FROM engagement_district_settings WHERE fk_district_id={district2}")
    if worker_club and worker_flags:
        steps.append(f"UPDATE club_master SET IsEnableBirthdayEmail={worker_flags[0]}, GreetingReviewedYearId={worker_flags[1]} "
                     f"WHERE pk_club_id={worker_club}")
    for k, v in flags_before.items():
        steps.append(f"UPDATE platform_features SET enabled={v} WHERE feature_key='{k}'" if v else
                     f"DELETE FROM platform_features WHERE feature_key='{k}'")
    for q in steps:
        sql(q)
    left = sql(f"SELECT (SELECT COUNT(*) FROM escalation_alerts WHERE pk_alert_id>{alert_mark}) "
               f"+ (SELECT COUNT(*) FROM engagement_events WHERE pk_engagement_event_id>{event_mark}) "
               f"+ (SELECT COUNT(*) FROM escalation_rules WHERE fk_district_id={district}) "
               f"+ (SELECT COUNT(*) FROM meeting_rules WHERE modified_by={M}) + (SELECT COUNT(*) FROM member_roles WHERE created_by={M}) "
               f"+ (SELECT COUNT(*) FROM district_ag WHERE created_by={M}) + (SELECT COUNT(*) FROM district_governors WHERE created_by={M}) "
               f"+ (SELECT COUNT(*) FROM club_dues WHERE created_by={M}) + (SELECT COUNT(*) FROM comm_templates WHERE modified_by={M})")
    check("clean-up leaves no test rows", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAIL'}")
sys.exit(1 if fails else 0)

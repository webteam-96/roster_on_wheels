"""N12 time zones: a district's IANA zone is saved and returned, and district-scoped jobs use its local day and hour.

    python -I kb/tools/time_zones_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). The reminder part needs
the API started with VolunteerReminders__Enabled=true (the volunteer reminder job alone; its test sign-ups use
example.org addresses). Needs the GreetingsWorker built (dotnet build row/workers/GreetingsWorker), or its dll in
ROW_GREETINGS_WORKER. Local copies only, never production, with no working email provider (the API run script points
Brevo at a dead local URL): the engagement pass attempts real members' milestone emails, which must fail locally. The
meeting email job is not driven (it would email the club's real members); meetings are checked through the iCal feed.

The two largest districts get Pacific/Kiritimati (UTC+14) and Pacific/Pago_Pago (UTC-11). Neither has daylight saving
and they are 25 hours apart, so they are on different dates at every moment. Writes the zones, greeting switches and
edit fields of the two districts, two join dates, invite prompts, a meeting, volunteer slots, feature switches and the
rows the jobs write; restores or removes all of them at the end (audit_log rows stay: that table is append-only).
"""
import base64, hashlib, hmac, json, os, re, secrets, subprocess, sys, time, urllib.error, urllib.request
from datetime import date, datetime, timedelta, timezone

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKER = os.environ.get('ROW_GREETINGS_WORKER') or os.path.join(
    ROOT, 'row', 'workers', 'GreetingsWorker', 'bin', 'Debug', 'net10.0', 'GreetingsWorker.dll')
KIRI, PAGO = 'Pacific/Kiritimati', 'Pacific/Pago_Pago'
OFFSET = {KIRI: 14, PAGO: -11}
FLAGS = ("meetings", "volunteers", "engagement", "contacts_growth", "target_dashboard")
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


def call(method, path, tok=None, body=None):
    headers = {"Authorization": f"Bearer {tok}"} if tok else {}
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            s, b = r.status, r.read()
    except urllib.error.HTTPError as e:
        s, b = e.code, e.read()
    try:
        return s, json.loads(b) if b else None
    except ValueError:
        return s, b.decode(errors="replace")


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))


def local(zone, utc=None):
    """Wall-clock time in a fixed-offset zone at a UTC instant (default: now)."""
    return (utc or datetime.now(timezone.utc)).replace(tzinfo=None) + timedelta(hours=OFFSET[zone])


def stamp(d):
    return d.strftime('%Y-%m-%d %H:%M:%S')


# ── Who is who (real ids, picked by query) ──────────────────────────────────────────────────────────────────
CHAIN = ("JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND IFNULL(c.isdeleted,0)=0 AND c.IsActive=1 "
         "JOIN district_master d ON d.pk_district_id=c.fk_district_id AND d.isdeleted=0 AND d.IsActive=1 "
         "JOIN zone_master z ON z.pk_zone_id=d.fk_zone_id AND z.isdeleted=0 AND z.IsActive=1 "
         "JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0 ")
ACTIVE = "cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0"
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND IFNULL(isdeleted,0)=0 LIMIT 1")[0]
plain = one("SELECT x.pk_member_master_profile_id FROM member_master_profile x WHERE x.isdeleted=0 AND NOT EXISTS "
            "(SELECT 1 FROM member_roles r WHERE r.fk_member_master_profile_id=x.pk_member_master_profile_id "
            "AND r.fk_role_id<>1 AND r.IsActive=1 AND IFNULL(r.isdeleted,0)=0) ORDER BY 1 LIMIT 1")[0]
t_sa, t_plain = token(sa, "SuperAdmin"), token(plain, "Member")
# The two districts with the most members whose number is unique (the worker filters by number).
pair = sql(f"SELECT d.pk_district_id, d.DistrictNumber FROM club_members cm {CHAIN} WHERE {ACTIVE} "
           "AND (SELECT COUNT(*) FROM district_master x WHERE x.DistrictNumber=d.DistrictNumber)=1 "
           "GROUP BY d.pk_district_id, d.DistrictNumber ORDER BY COUNT(*) DESC LIMIT 2").splitlines()
if len(pair) < 2:
    sys.exit("setup: needs two active districts with members")
(A, A_NUM), (B, B_NUM) = [(int(r.split('\t')[0]), r.split('\t')[1]) for r in pair]
CA, CB = [one(f"SELECT c.pk_club_id FROM club_members cm {CHAIN} WHERE {ACTIVE} AND d.pk_district_id={d} "
              "GROUP BY c.pk_club_id ORDER BY COUNT(*) DESC, 1 LIMIT 1")[0] for d in (A, B)]
year_id, y_start, y_end = one("SELECT pk_year_id, StartDate, EndDate FROM rotary_year_master WHERE IsCurrent=1 AND isdeleted=0 LIMIT 1")
print(f"district {A} ({KIRI}, club {CA}), district {B} ({PAGO}, club {CB})")

# ── State to restore ────────────────────────────────────────────────────────────────────────────────────────
D_COLS = ("Timezone", "IsEnableBirthdayNotification", "IsGreetingSendPush", "GreetingReviewedYearId",
          "DistrictLogoPath", "Country", "DefaultCurrency", "modified_by", "modified_date")
d_before = {d: sql(f"SELECT {', '.join(f'QUOTE({c})' for c in D_COLS)} FROM district_master WHERE pk_district_id={d}").split('\t')
            for d in (A, B)}
ca_before = sql(f"SELECT QUOTE(IsEnableBirthdayNotification), QUOTE(GreetingReviewedYearId) FROM club_master WHERE pk_club_id={CA}").split('\t')
flags_before = {k: sql(f"SELECT enabled FROM platform_features WHERE feature_key='{k}'") for k in FLAGS}
marks = {t: int(sql(f"SELECT IFNULL(MAX({k}),0) FROM {t}")) for t, k in
         (("engagement_events", "pk_engagement_event_id"), ("email_log", "pk_id"), ("district_modules", "pk_district_module_id"))}
joined_before = {}            # club_members pk -> QUOTE(JoinedDate)
created = {"prompts": [], "attendance": [], "sheets": [], "feed": None}

try:
    for k in FLAGS:
        s, _ = call("PUT", f"/api/features/{k}", t_sa, {"enabled": True})
        if s not in (200, 204):
            sys.exit(f"setup: could not switch on {k} ({s})")

    # ── District edit carries the zone (create refuses a bad one; no test district: hard deletes are blocked) ──
    s, cur = call("GET", f"/api/districts/{A}", t_sa)
    base = {k: cur[k] for k in ("districtNumber", "districtLogoPath", "isActive", "fkZoneId", "country", "defaultCurrency")}
    s, _ = call("POST", "/api/districts", t_sa, {**base, "districtNumber": "E2E-TZ", "timezone": "Mars/Phobos"})
    check("create: an unknown zone is refused (400)", s == 400, s)
    s, _ = call("PUT", f"/api/districts/{A}", t_plain, {**base, "timezone": KIRI})
    check("edit: a plain member cannot change the zone (403)", s == 403, s)
    for bad in ("Not/AZone", "Eastern Standard Time"):
        s, _ = call("PUT", f"/api/districts/{A}", t_sa, {**base, "timezone": bad})
        check(f"edit: '{bad}' is not an IANA zone (400)", s == 400, s)
    s, _ = call("PUT", f"/api/districts/{A}", t_sa, {**base, "timezone": ""})
    s2, b = call("GET", f"/api/districts/{A}", t_sa)
    check("edit: a blank zone is the instance default (null)", s == 204 and s2 == 200 and b.get("timezone") is None, (s, s2))
    s, _ = call("PUT", f"/api/districts/{A}", t_sa, {**base, "timezone": KIRI})
    s2, b = call("GET", f"/api/districts/{A}", t_sa)
    check("edit: SuperAdmin saves the zone and the district read returns it", s == 204 and b.get("timezone") == KIRI, (s, b.get("timezone")))
    stored_utc = str(b.get("modifiedDate") or "").endswith("Z")   # the API writes "Z" exactly when stored times are UTC
    s, b = call("GET", f"/api/districts?search={A_NUM}&pageSize=50", t_sa)
    item = next((i for i in (b or {}).get("items", []) if i.get("id") == A), None) if s == 200 else None
    check("the district list returns the zone", item is not None and item.get("timezone") == KIRI, item and item.get("timezone"))
    sql(f"UPDATE district_master SET Timezone='{PAGO}' WHERE pk_district_id={B}")

    # ── GreetingsWorker at a mocked clock ───────────────────────────────────────────────────────────────────
    # Each source: zone, local date/hour and due/waiting from --now; the celebrants are those of its local date.
    # Greeting switches on for the runs; the year marker keeps the stale-message pause off.
    for d in (A, B):
        sql(f"UPDATE district_master SET IsEnableBirthdayNotification=1, IsGreetingSendPush=1, GreetingReviewedYearId={year_id} "
            f"WHERE pk_district_id={d}")
    sql(f"UPDATE club_master SET IsEnableBirthdayNotification=1, GreetingReviewedYearId={year_id} WHERE pk_club_id={CA}")

    def birthdays(d, day):
        return int(sql(f"SELECT COUNT(DISTINCT m.pk_member_master_profile_id) FROM club_members cm "
                       "JOIN club_master c ON c.pk_club_id=cm.fk_club_id AND c.isdeleted=0 AND c.IsActive=1 "
                       "JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND m.isdeleted=0 "
                       f"WHERE c.fk_district_id={d} AND cm.IsActive=1 AND cm.isdeleted=0 AND m.BirthDate IS NOT NULL "
                       f"AND MONTH(m.BirthDate)={day.month} AND DAY(m.BirthDate)={day.day}"))

    # the birthday with the most celebrants in district A, in a leap year so 29 February works too
    bm, bd = one("SELECT MONTH(m.BirthDate), DAY(m.BirthDate) FROM club_members cm JOIN club_master c ON c.pk_club_id=cm.fk_club_id "
                 "AND c.isdeleted=0 AND c.IsActive=1 JOIN member_master_profile m ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id "
                 f"AND m.isdeleted=0 WHERE c.fk_district_id={A} AND cm.IsActive=1 AND cm.isdeleted=0 AND m.BirthDate IS NOT NULL "
                 "GROUP BY 1, 2 ORDER BY COUNT(DISTINCT m.pk_member_master_profile_id) DESC LIMIT 1")
    day_a = date(2028, bm, bd)
    mock = datetime(2028, bm, bd, 8, 30) - timedelta(hours=OFFSET[KIRI])   # 08:30 in district A, as UTC
    day_b = (mock + timedelta(hours=OFFSET[PAGO])).date()

    def worker(*args):
        env = dict(os.environ, ConnectionStrings__DefaultConnection=f"Server=127.0.0.1;Port={PORT};Database={DB};User Id=root;Password=;",
                   Brevo__ApiKey="e2e-dummy", Brevo__ApiUrl="http://127.0.0.1:9/v3/smtp/email")
        r = subprocess.run(["dotnet", WORKER, "--dry-run", *args], capture_output=True, env=env, timeout=300)
        return r.returncode, r.stdout.decode("utf-8", errors="replace")   # never printed: it names members

    def source_line(out, kind, source_id):
        m = re.search(rf"\[DRY\] {kind} #{source_id} '[^\n]*?': (\S+) local (\S+ \S+), match (\S+), ([^\r\n]+)", out)
        return m.groups() if m else None

    def celebrants(out):
        return len(re.findall(r"\[DRY\] (?:SKIP )?Push Birthday ", out))

    if not os.path.exists(WORKER):
        check("GreetingsWorker is built", False, WORKER)
    else:
        utc_iso = mock.strftime('%Y-%m-%dT%H:%M:%SZ')
        code, out = worker("--district-number", A_NUM, "--now", utc_iso)
        line = source_line(out, "District", A)
        check("worker: district A works in its own zone and local date (08:30, due)",
              code == 0 and line == (KIRI, f"{day_a:%Y-%m-%d} 08:30", f"{day_a:%m-%d}", "due"), (code, line))
        check("worker: district A greets the birthdays of its local date",
              celebrants(out) == birthdays(A, day_a) > 0, (celebrants(out), birthdays(A, day_a)))
        code, out = worker("--district-number", B_NUM, "--now", utc_iso)
        line = source_line(out, "District", B)
        check("worker: at the same instant district B is on the day before and waits for 08:00",
              code == 0 and line == (PAGO, f"{day_b:%Y-%m-%d} 07:30", f"{day_b:%m-%d}", "waiting for 08:00")
              and celebrants(out) == 0, (code, line, celebrants(out)))
        code, out = worker("--district-number", B_NUM, "--now", (mock + timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))
        line = source_line(out, "District", B)
        check("worker: an hour later district B is due and greets the birthdays of its own date",
              code == 0 and line == (PAGO, f"{day_b:%Y-%m-%d} 08:30", f"{day_b:%m-%d}", "due")
              and celebrants(out) == birthdays(B, day_b), (code, line, celebrants(out), birthdays(B, day_b)))
        code, out = worker("--club-name", sql(f"SELECT ClubName FROM club_master WHERE pk_club_id={CA}"), "--now", utc_iso)
        line = source_line(out, "Club", CA)
        check("worker: a club uses its district's zone", code == 0 and line is not None and line[:2] == (KIRI, f"{day_a:%Y-%m-%d} 08:30"),
              (code, line))

    # ── Real clock from here: today in each zone ────────────────────────────────────────────────────────────
    now_a, now_b = local(KIRI), local(PAGO)
    today_a, today_b = now_a.date(), now_b.date()

    # ── Invite prompts: "today" is the club's local date ─────────────────────────────────────────────────────
    s, b = call("POST", f"/api/clubs/{CA}/invite-prompts", t_sa, {"meetingDate": f"{today_b}", "daysBefore": 0})
    check("invite prompt: district B's date has already passed for a club in district A (400)", s == 400, (s, b))
    for club, today in ((CA, today_a), (CB, today_b)):
        s, b = call("POST", f"/api/clubs/{club}/invite-prompts", t_sa, {"meetingDate": f"{today + timedelta(days=1)}", "daysBefore": 3})
        pid = (b or {}).get("id") if s == 200 else None
        if pid:
            created["prompts"].append(pid)
            call("DELETE", f"/api/clubs/{club}/invite-prompts/{pid}", t_sa)   # cancelled at once: the hourly job never sends it
        send_on = sql(f"SELECT send_on FROM invite_prompts WHERE pk_invite_prompt_id={pid}") if pid else None
        check(f"invite prompt: club {club} sends from its own local today ({today})", send_on == f"{today}", (s, send_on))

    # ── Engagement: a milestone comes round on the district's local date ─────────────────────────────────────
    def years_for(d):
        y = sql(f"SELECT milestone_years FROM engagement_district_settings WHERE fk_district_id={d}")
        return sorted(int(x) for x in y.split(',') if x.strip()) if y else [1, 3, 5, 10]

    def member_in(d, years):
        return one(f"SELECT cm.pk_club_member_id, cm.fk_member_master_profile_id FROM club_members cm {CHAIN} "
                   f"WHERE {ACTIVE} AND d.pk_district_id={d} AND NOT EXISTS (SELECT 1 FROM engagement_events e "
                   f"WHERE e.dedupe_key=CONCAT('MILESTONE:', cm.fk_member_master_profile_id, ':', {years})) "
                   "ORDER BY IFNULL(m.EmailId,'')<>'', 1 LIMIT 1")

    ya = (years_for(A) or [None])[0]
    yb = next((y for y in years_for(B) if y - 1 not in years_for(B)), None)   # one year less is no milestone in B
    if ya and yb:
        (cm_a, mem_a), (cm_b, mem_b) = member_in(A, ya), member_in(B, yb)
        for pk in (cm_a, cm_b):
            joined_before[pk] = sql(f"SELECT QUOTE(JoinedDate) FROM club_members WHERE pk_club_member_id={pk}")
        # both joined exactly N years before district A's date: today in A, still to come in B
        sql(f"UPDATE club_members SET JoinedDate='{today_a.replace(year=today_a.year - ya)}' WHERE pk_club_member_id={cm_a}")
        sql(f"UPDATE club_members SET JoinedDate='{today_a.replace(year=today_a.year - yb)}' WHERE pk_club_member_id={cm_b}")
        for d in (A, B):
            call("POST", f"/api/engagement/run?districtId={d}", t_sa)
        got_a = sql(f"SELECT occurred_on FROM engagement_events WHERE dedupe_key='MILESTONE:{mem_a}:{ya}'")
        got_b = sql(f"SELECT COUNT(*) FROM engagement_events WHERE dedupe_key='MILESTONE:{mem_b}:{yb}'")
        check("engagement: the milestone comes round on district A's local date", got_a == f"{today_a}", got_a)
        check("engagement: the same join date is not yet a milestone on district B's date", got_b == "0", got_b)
    else:
        check("engagement: milestone years usable for the test", False, (ya, yb))

    # ── Target dashboard: share of the Rotary year by the district's local date ──────────────────────────────
    ys, ye = date.fromisoformat(str(y_start)[:10]), date.fromisoformat(str(y_end)[:10])
    for d, today in ((A, today_a), (B, today_b)):
        s, b = call("GET", f"/api/districts/{d}/targets", t_sa)
        want = round(min(max(((today - ys).days + 1) / ((ye - ys).days + 1), 0), 1) * 100)
        got = (b or {}).get("yearElapsedPercent") if s == 200 else None
        check(f"target dashboard: district {d} counts the year to its local date ({today})", got == want, (s, got, want))

    # ── iCal: stored UTC goes out with Z, a wall-clock time names the district zone ──────────────────────────
    # Three days ahead, so no reminder job picks the meeting up.
    meet = (now_a + timedelta(days=3)).replace(minute=0, second=0, microsecond=0)
    created["attendance"].append(int(sql(
        "INSERT INTO club_attendance (fk_club_id, fk_year_id, EventName, EventDateTime, MeetingMode, created_by) "
        f"VALUES ({CA}, {year_id}, 'e2e time zone meeting', '{stamp(meet)}', 'in_person', {sa}); SELECT LAST_INSERT_ID();")))
    feed = sql(f"SELECT token FROM meeting_calendar_feeds WHERE fk_club_id={CA}")
    if not feed:
        feed = secrets.token_hex(32).upper()
        created["feed"] = int(sql(f"INSERT INTO meeting_calendar_feeds (token, fk_club_id, created_by) "
                                  f"VALUES ('{feed}', {CA}, {sa}); SELECT LAST_INSERT_ID();"))
    s, ics = call("GET", f"/api/public/calendar/{feed}.ics")
    uid = f"UID:row-meeting-{created['attendance'][0]}\r\n"
    event = ics.split(uid, 1)[1].split("END:VEVENT", 1)[0] if s == 200 and isinstance(ics, str) and uid in ics else ""
    want = f"DTSTART:{meet:%Y%m%dT%H%M%S}Z" if stored_utc else f"DTSTART;TZID={KIRI}:{meet:%Y%m%dT%H%M%S}"
    check(f"iCal: the meeting starts {'in UTC' if stored_utc else 'in the district zone'}", want in event, (s, event[:120]))

    # ── Volunteer reminders (the real job): the same wall-clock slot time in both zones ──────────────────────
    def signup(club, at, tag):
        sheet = int(sql("INSERT INTO volunteer_sheets (fk_club_id, title, public_token, created_by) "
                        f"VALUES ({club}, 'e2e time zones', '{secrets.token_hex(16)}', {sa}); SELECT LAST_INSERT_ID();"))
        created["sheets"].append(sheet)
        slot = int(sql(f"INSERT INTO volunteer_slots (fk_sheet_id, task, starts_at, capacity) VALUES ({sheet}, 'e2e', '{stamp(at)}', 1); "
                       "SELECT LAST_INSERT_ID();"))
        return int(sql(f"INSERT INTO volunteer_signups (fk_slot_id, name, email) VALUES ({slot}, 'e2e', 'e2e-tz-{tag}@example.org'); "
                       "SELECT LAST_INSERT_ID();"))

    def reminded(signup_id):
        return sql(f"SELECT reminder_sent_at IS NOT NULL FROM volunteer_signups WHERE pk_signup_id={signup_id}") == "1"

    wall = (now_a + timedelta(hours=2)).replace(second=0, microsecond=0)        # due in A; 27 hours ahead in B
    v_a, v_b_same = signup(CA, wall, "a"), signup(CB, wall, "b1")
    v_b_own = signup(CB, (now_b + timedelta(hours=2)).replace(second=0, microsecond=0), "b2")   # due in B
    deadline = time.time() + 100   # the job runs every minute
    while time.time() < deadline and not (reminded(v_a) and reminded(v_b_own)):
        time.sleep(5)
    hint = "no reminder at all: is the API started with VolunteerReminders__Enabled=true?"
    check("volunteers: a slot 2 hours ahead in district A's zone is reminded", reminded(v_a), hint)
    check("volunteers: a slot 2 hours ahead in district B's zone is reminded", reminded(v_b_own), hint)
    check("volunteers: the same wall-clock time as A's, 27 hours ahead in district B, is not", not reminded(v_b_same))

finally:
    # ── Clean up ────────────────────────────────────────────────────────────────────────────────────────────
    for d, vals in d_before.items():
        sql(f"UPDATE district_master SET {', '.join(f'{c}={v}' for c, v in zip(D_COLS, vals))} WHERE pk_district_id={d}")
    sql(f"UPDATE club_master SET IsEnableBirthdayNotification={ca_before[0]}, GreetingReviewedYearId={ca_before[1]} WHERE pk_club_id={CA}")
    for pk, v in joined_before.items():
        sql(f"UPDATE club_members SET JoinedDate={v} WHERE pk_club_member_id={pk}")
    if created["prompts"]:
        sql(f"DELETE FROM invite_prompts WHERE pk_invite_prompt_id IN ({','.join(map(str, created['prompts']))})")
    for sheet in created["sheets"]:
        sql(f"DELETE FROM volunteer_sheets WHERE pk_sheet_id={sheet}")   # slots and sign-ups cascade
    if created["attendance"]:
        ids = ','.join(map(str, created['attendance']))
        sql(f"DELETE FROM meeting_reminder_log WHERE fk_attendance_id IN ({ids})")
        sql(f"DELETE FROM club_attendance WHERE pk_attendance_id IN ({ids})")
    if created["feed"]:
        sql(f"DELETE FROM meeting_calendar_feeds WHERE pk_feed_id={created['feed']}")
    # what the run wrote: default modules the district edit assigns, milestones, the mails that failed to go
    sql(f"DELETE FROM district_modules WHERE fk_district_id={A} AND pk_district_module_id>{marks['district_modules']}")
    sql(f"DELETE FROM engagement_events WHERE pk_engagement_event_id>{marks['engagement_events']}")
    sql(f"DELETE FROM email_log WHERE pk_id>{marks['email_log']}")
    for k in FLAGS:
        call("PUT", f"/api/features/{k}", t_sa, {"enabled": False})
        v = flags_before[k]
        sql(f"UPDATE platform_features SET enabled={v} WHERE feature_key='{k}'" if v else
            f"DELETE FROM platform_features WHERE feature_key='{k}'")
    left = sql("SELECT (SELECT COUNT(*) FROM volunteer_signups WHERE email LIKE 'e2e-tz-%@example.org') + "
               "(SELECT COUNT(*) FROM club_attendance WHERE EventName='e2e time zone meeting') + "
               f"(SELECT COUNT(*) FROM engagement_events WHERE pk_engagement_event_id>{marks['engagement_events']}) + "
               f"(SELECT COUNT(*) FROM district_master WHERE pk_district_id IN ({A},{B}) AND Timezone IN ('{KIRI}','{PAGO}'))")
    check("clean-up leaves no test rows", left == "0", left)

print(f"\n{'ALL PASS' if fails == 0 else f'{fails} FAIL'}")
sys.exit(1 if fails else 0)

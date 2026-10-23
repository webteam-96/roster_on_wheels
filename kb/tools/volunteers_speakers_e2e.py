"""Volunteers and speakers (ROW build spec 3.13): a club opens a sign-up sheet for an event and a service project,
members sign up from the app, a non-member signs up through the public link, reminders go out, and the hours recorded
afterwards roll into the project's man-hours. Speakers on the website (no contact details) and in the bulletin feed;
meeting duties with reminders. Also: the feature flag, role gating, capacity under concurrency, spam protection, the
rate limit, and each club seeing only its own records.

    python -I kb/tools/volunteers_speakers_e2e.py <api_base> <mysql_port> <database>
JWT secret from ROW_E2E_JWT_SECRET (the API must be started with the same JwtSettings__Secret). The reminder part needs
the API started with VolunteerReminders__Enabled=true (the reminder job alone; it fails safely without a mail key).
Writes test rows to the given LOCAL database only and removes them at the end (one project row, one event row, the
sheets, speakers, duties, uploaded photos, the reminder email_log rows, the feature switch). audit_log rows stay: that
table is append-only by design. Never run it against production.
"""
import base64, hashlib, hmac, json, os, random, secrets, struct, subprocess, sys, threading, time, urllib.error, urllib.request, zlib
from datetime import date, datetime, timedelta

API, PORT, DB = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
SECRET = os.environ['ROW_E2E_JWT_SECRET']
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
WWWROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'row', 'api', 'wwwroot')
MARK = 'e2e-vol'
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def one(q):
    v = sql(q)
    return int(float(v)) if v and v != 'NULL' else None


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def token(member_id, roles):
    body = {"memberId": str(member_id), "name": "e2e", "email": "e2e@example.org", "roles": roles,
            "iss": "JwtIssuer", "aud": "JwtAudience", "exp": int(time.time()) + 1800}
    signing = f"{b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())}.{b64(json.dumps(body).encode())}"
    return f"{signing}.{b64(hmac.new(SECRET.encode(), signing.encode(), hashlib.sha256).digest())}"


def call(method, path, tok=None, body=None, raw=None, ctype=None, ip=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {}
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    if ip:
        headers["X-Forwarded-For"] = ip  # the API trusts loopback proxies: one rate-limit bucket per fake IP
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


def upload(path, tok, filename, content):
    b = "----e2e" + secrets.token_hex(8)
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f'Content-Type: image/png\r\n\r\n').encode() + content + f"\r\n--{b}--\r\n".encode()
    return call("POST", path, tok, raw=body, ctype=f"multipart/form-data; boundary={b}")


def png(w=4, h=4):
    raw = b''.join(b'\x00' + b'\x17\x45\x8f' * w for _ in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def check(name, ok, detail=""):
    global fails
    fails += 0 if ok else 1
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:300]}"))


def msg(r):
    return r[1].get("message") if isinstance(r[1], dict) else r[1]


def at(delta):
    return (datetime.now() + delta).replace(microsecond=0).isoformat()


def fake_ip():
    return f"10.{random.randint(1, 254)}.{random.randint(1, 254)}.{random.randint(1, 254)}"


# ── People and places, picked by query ────────────────────────────────────────────────────────────────────────
ADMIN_ROLE = "r.fk_role_id=2 AND r.IsActive=1 AND r.isdeleted=0"
NO_ROLES = ("NOT EXISTS (SELECT 1 FROM member_roles x WHERE x.fk_member_master_profile_id=cm.fk_member_master_profile_id "
            "AND x.fk_role_id<>1 AND x.IsActive=1 AND x.isdeleted=0)")
PLAIN = (f"SELECT cm.fk_member_master_profile_id FROM club_members cm JOIN member_master_profile m "
         f"ON m.pk_member_master_profile_id=cm.fk_member_master_profile_id AND IFNULL(m.isdeleted,0)=0 "
         f"WHERE cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 AND {NO_ROLES} AND cm.fk_club_id=")
ACTIVE_CHAIN = ("JOIN district_master d ON d.pk_district_id=c.fk_district_id AND d.IsActive=1 AND d.isdeleted=0 "
                "JOIN zone_master z ON z.pk_zone_id=d.fk_zone_id AND z.IsActive=1 AND z.isdeleted=0")
clubs = [int(x) for x in sql(
    "SELECT DISTINCT r.fk_club_id FROM member_roles r JOIN club_master c ON c.pk_club_id=r.fk_club_id "
    f"{ACTIVE_CHAIN} WHERE {ADMIN_ROLE} AND c.IsActive=1 AND IFNULL(c.isdeleted,0)=0 "
    "AND (SELECT COUNT(*) FROM club_members cm WHERE cm.fk_club_id=c.pk_club_id AND cm.IsActive=1 AND IFNULL(cm.isdeleted,0)=0 "
    f"AND {NO_ROLES})>=2 ORDER BY 1 LIMIT 2").split()]


def admin_of(club, other):
    """An Admin of this club who is not an Admin of the other club and has no district-wide role."""
    return one(f"SELECT r.fk_member_master_profile_id FROM member_roles r WHERE {ADMIN_ROLE} AND r.fk_club_id={club} "
               "AND NOT EXISTS (SELECT 1 FROM member_roles y WHERE y.fk_member_master_profile_id=r.fk_member_master_profile_id "
               f"AND y.IsActive=1 AND y.isdeleted=0 AND (y.fk_role_id IN (3,4,7) OR y.fk_club_id={other} "
               "OR (y.fk_role_id=2 AND IFNULL(y.fk_club_id,0)=0))) ORDER BY 1 LIMIT 1")


club_a, club_b = clubs[0], clubs[1]
admin_a, admin_b = admin_of(club_a, club_b), admin_of(club_b, club_a)
plain, plain2 = [int(x) for x in sql(PLAIN + f"{club_a} ORDER BY 1 LIMIT 2").split()]
other = one(PLAIN + f"{club_b} AND cm.fk_member_master_profile_id NOT IN "
            f"(SELECT fk_member_master_profile_id FROM club_members WHERE fk_club_id={club_a}) ORDER BY 1 LIMIT 1")
sa = one("SELECT fk_member_master_profile_id FROM member_roles WHERE fk_role_id=3 AND IsActive=1 AND isdeleted=0 LIMIT 1")
year = one("SELECT pk_year_id FROM rotary_year_master WHERE IsCurrent=1 AND isdeleted=0 LIMIT 1")
projects_table = "rotary_projects_" + sql(f"SELECT YearLabel FROM rotary_year_master WHERE pk_year_id={year}").replace("-", "_")
module_id = one("SELECT pk_module_id FROM module_master WHERE isdeleted=0 ORDER BY pk_module_id LIMIT 1")
assert None not in (admin_a, admin_b, plain, plain2, other, sa, year, module_id), "test data missing"
print(f"clubs {club_a}/{club_b}, admins {admin_a}/{admin_b}, members {plain}/{plain2}/{other}, year {year}")

t_a, t_b, t_sa = token(admin_a, "Admin"), token(admin_b, "Admin"), token(sa, "SuperAdmin")
t_plain, t_plain2, t_other = token(plain, "Member"), token(plain2, "Member"), token(other, "Member")

# ── Setup (undone in finally) ───────────────────────────────────────────────────────────────────────────────────


def cleanup():
    folder = os.path.join(WWWROOT, 'Documents', 'Speakers', f'Group{club_a}')
    for sid in sql(f"SELECT pk_speaker_id FROM club_speakers WHERE name LIKE '{MARK}%'").split():
        for f in (os.listdir(folder) if os.path.isdir(folder) else []):
            if f.startswith(f"speaker-{sid}-"):
                os.remove(os.path.join(folder, f))
    for d in (folder, os.path.dirname(folder)):  # empty folders only: real photos keep theirs
        if os.path.isdir(d) and not os.listdir(d):
            os.rmdir(d)
    sql(f"DELETE FROM volunteer_sheets WHERE title LIKE '{MARK}%'; DELETE FROM club_speakers WHERE name LIKE '{MARK}%'; "
        f"DELETE FROM meeting_duties WHERE duty LIKE '{MARK}%'; DELETE FROM upcoming_events WHERE Title LIKE '{MARK}%'; "
        f"DELETE FROM `{projects_table}` WHERE title LIKE '{MARK}%'; "
        f"DELETE FROM email_log WHERE subject LIKE 'Reminder: {MARK}%' OR subject LIKE 'Meeting duty: {MARK}%'")


cleanup()
flag_before = sql("SELECT enabled FROM platform_features WHERE feature_key='volunteers'")
sql(f"INSERT INTO `{projects_table}` (fk_club_id, fk_module_id, fk_year_id, title, project_date, man_hours, isdeleted) "
    f"VALUES ({club_a}, {module_id}, {year}, '{MARK} project', CURDATE(), 10, 0)")
project = one(f"SELECT MAX(pk_project_id) FROM `{projects_table}` WHERE title='{MARK} project'")
sql(f"INSERT INTO upcoming_events (fk_club_id, Title, EventDate, PublishDate, ExpiryDate, Status) "
    f"VALUES ({club_a}, '{MARK} event', NOW() + INTERVAL 3 DAY, NOW(), NOW() + INTERVAL 10 DAY, 'Published')")
event = one(f"SELECT MAX(pk_upcoming_event_id) FROM upcoming_events WHERE Title='{MARK} event'")
man_hours = lambda: one(f"SELECT man_hours FROM `{projects_table}` WHERE pk_project_id={project}")
A, B = f"/api/clubs/{club_a}/volunteer-sheets", f"/api/clubs/{club_b}/volunteer-sheets"
SP, DU = f"/api/clubs/{club_a}/speakers", f"/api/clubs/{club_a}/meeting-duties"
IP = fake_ip()

try:
    # ── Feature flag ───────────────────────────────────────────────────────────────────────────────────────────
    if flag_before != "1":
        check("module is off until switched on (club route 404)", call("GET", A, t_a)[0] == 404)
        check("module off: public speakers 404", call("GET", f"/api/public/club/{club_a}/speakers")[0] == 404)
        check("module off: app route 404", call("GET", "/api/mobile/volunteers", t_plain)[0] == 404)
    check("club admin cannot switch features", call("PUT", "/api/features/volunteers", t_a, {"enabled": True})[0] == 403)
    r = call("PUT", "/api/features/volunteers", t_sa, {"enabled": True})
    check("SuperAdmin switches volunteers on", r[0] == 204, r)

    # ── Sheets: gating and validation ──────────────────────────────────────────────────────────────────────────
    check("club admin lists sheets", call("GET", A, t_a)[0] == 200)
    check("plain member cannot list the club's sheets", call("GET", A, t_plain)[0] == 403)
    check("other club's admin cannot list them", call("GET", A, t_b)[0] == 403)
    slots = [{"task": f"{MARK} set up tables", "startsAt": at(timedelta(hours=2)), "endsAt": at(timedelta(hours=3)), "capacity": 1},
             {"task": f"{MARK} serve food", "startsAt": at(timedelta(days=3)), "capacity": 2},
             {"task": f"{MARK} race", "startsAt": at(timedelta(days=5)), "capacity": 1}]
    form = {"title": f"{MARK} food drive", "description": "Volunteers for the food drive.", "eventId": event,
            "yearId": year, "projectId": project, "isPublic": True, "status": "open", "slots": slots}
    r = call("GET", f"{A}/targets?yearId={year}", t_a)
    check("targets list the club's event and project", r[0] == 200 and any(e["id"] == event for e in r[1]["events"])
          and any(p["id"] == project for p in r[1]["projects"]), r)
    check("a sheet needs slots", call("POST", A, t_a, dict(form, slots=[]))[0] == 400)
    bad = [dict(slots[0], endsAt=at(timedelta(hours=1)))]
    check("a slot cannot end before it starts", call("POST", A, t_a, dict(form, slots=bad))[0] == 400)
    r = call("POST", A, t_a, dict(form, projectId=999999999))
    check("only the club's own project", r[0] == 400 and "Project" in str(msg(r)), r)
    r = call("POST", B, t_b, form)
    check("another club cannot link this club's event", r[0] == 400 and "Event" in str(msg(r)), r)
    check("plain member cannot create a sheet", call("POST", A, t_plain, form)[0] == 403)
    r = call("POST", A, t_a, form)
    check("club admin creates the sheet", r[0] == 200 and r[1].get("id"), r)
    sheet = r[1]["id"]
    r = call("GET", f"{A}/{sheet}", t_a)
    check("sheet reads back with its event, project and slots", r[0] == 200 and r[1]["eventTitle"] == f"{MARK} event"
          and r[1]["projectTitle"] == f"{MARK} project" and len(r[1]["slots"]) == 3 and len(r[1]["publicToken"]) == 32, r)
    detail = r[1]
    slot_a, slot_b, slot_race = [s["id"] for s in detail["slots"]]
    tok = detail["publicToken"]
    check("plain member cannot read the sheet's sign-ups", call("GET", f"{A}/{sheet}", t_plain)[0] == 403)
    check("other club's admin gets nothing through their own club", call("GET", f"{B}/{sheet}", t_b)[0] == 404)
    audit = one(f"SELECT COUNT(*) FROM audit_log WHERE entity_type='Volunteer Sheet' AND fk_member_master_profile_id={admin_a} "
                f"AND details='POST /api/clubs/{club_a}/volunteer-sheets' AND created_date >= NOW() - INTERVAL 5 MINUTE")
    check("sheet creation is in the audit log", (audit or 0) >= 1, audit)
    r = call("POST", A, t_a, dict(form, title=f"{MARK} private", isPublic=False, eventId=None, yearId=None, projectId=None,
                                    slots=[{"task": f"{MARK} private task", "startsAt": at(timedelta(days=4)), "capacity": 3}]))
    private = r[1]["id"]
    pd = call("GET", f"{A}/{private}", t_a)[1]
    private_slot, private_tok = pd["slots"][0]["id"], pd["publicToken"]

    # ── Members sign up from the app ───────────────────────────────────────────────────────────────────────────
    r = call("POST", f"/api/mobile/volunteers/slots/{slot_a}/signup", t_plain)
    check("member signs up", r[0] == 204, r)
    r = call("POST", f"/api/mobile/volunteers/slots/{slot_a}/signup", t_plain)
    check("member cannot sign up twice", r[0] == 400 and "already" in str(msg(r)), r)
    r = call("POST", f"/api/mobile/volunteers/slots/{slot_a}/signup", t_plain2)
    check("a full slot refuses the next member", r[0] == 400 and "full" in str(msg(r)), r)
    r = call("POST", f"/api/mobile/volunteers/slots/{slot_b}/signup", t_other)
    check("a member of another club cannot sign up", r[0] == 403, r)
    check("unknown slot is 404", call("POST", "/api/mobile/volunteers/slots/999999999/signup", t_plain)[0] == 404)
    r = call("GET", "/api/mobile/volunteers", t_plain)
    mine = next((s for s in r[1] if s["id"] == sheet), None) if r[0] == 200 else None
    check("the app lists the sheet with the member's slot marked",
          mine and any(s["id"] == slot_a and s["signedUp"] for s in mine["slots"]) and "signups" not in json.dumps(mine), r)
    check("member cancels their place", call("DELETE", f"/api/mobile/volunteers/slots/{slot_a}/signup", t_plain)[0] == 204)
    check("the place frees up", one(f"SELECT filled FROM volunteer_slots WHERE pk_slot_id={slot_a}") == 0)
    check("member signs up again", call("POST", f"/api/mobile/volunteers/slots/{slot_a}/signup", t_plain)[0] == 204)

    # ── A non-member signs up through the public link ──────────────────────────────────────────────────────────
    check("unknown link is 404", call("GET", "/api/public/volunteers/" + "0" * 32)[0] == 404)
    check("a sheet without a public link is 404", call("GET", f"/api/public/volunteers/{private_tok}")[0] == 404)
    r = call("GET", f"/api/public/volunteers/{tok}")
    check("public page lists open slots without names", r[0] == 200 and r[1]["formToken"]
          and {s["id"]: s["spotsLeft"] for s in r[1]["slots"]} == {slot_a: 0, slot_b: 2, slot_race: 1}
          and "name" not in json.dumps(r[1]["slots"]), r)
    ft = r[1]["formToken"]
    person = {"slotId": slot_b, "name": "E2E Visitor", "email": "e2e-visitor@example.org", "consent": True, "formToken": ft}
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=person, ip=IP)
    check("a form sent at once is refused (bot speed)", r[0] == 400, r)
    time.sleep(3.3)
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=dict(person, consent=False), ip=IP)
    check("consent is required", r[0] == 400, r)
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=dict(person, email="not-an-email"), ip=IP)
    check("a bad email is refused", r[0] == 400, r)
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=dict(person, formToken="forged"), ip=IP)
    check("a forged form token is refused", r[0] == 400 and "expired" in str(msg(r)), r)
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=dict(person, email="bot@example.org", website="http://spam"), ip=IP)
    check("honeypot: a bot gets the usual answer and nothing is stored", r[0] == 200
          and one("SELECT COUNT(*) FROM volunteer_signups WHERE email='bot@example.org'") == 0, r)
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=person, ip=IP)
    check("non-member signs up with name, email and consent", r[0] == 200, r)
    row = sql(f"SELECT fk_member_id IS NULL, name, email, consent_at IS NOT NULL FROM volunteer_signups WHERE fk_slot_id={slot_b}")
    check("their own name and email are stored with the consent time", row.split("\t") == ["1", "E2E Visitor", "e2e-visitor@example.org", "1"], row)
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=dict(person, email="E2E-Visitor@example.org "), ip=IP)
    check("the same email cannot take two places in a slot", r[0] == 400 and "already" in str(msg(r)), r)
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=dict(person, name="E2E Second", email="e2e-second@example.org"), ip=IP)
    check("a second non-member fills the slot", r[0] == 200, r)
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=dict(person, name="E2E Third", email="e2e-third@example.org"), ip=IP)
    check("a full slot refuses the next sign-up", r[0] == 400 and "full" in str(msg(r)), r)
    r = call("POST", f"/api/public/volunteers/{tok}/signup", body=dict(person, slotId=private_slot, email="e2e-x@example.org"), ip=IP)
    check("another sheet's slot cannot be reached through this link", r[0] == 404, r)

    # capacity holds when people sign up at the same moment
    results = []

    def racer(i):
        results.append(call("POST", f"/api/public/volunteers/{tok}/signup", ip=fake_ip(),
                            body=dict(person, slotId=slot_race, name=f"E2E Racer {i}", email=f"e2e-racer{i}@example.org"))[0])
    threads = [threading.Thread(target=racer, args=(i,)) for i in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    check("six people at once for one place: exactly one gets it", sorted(results) == [200, 400, 400, 400, 400, 400]
          and one(f"SELECT COUNT(*) FROM volunteer_signups WHERE fk_slot_id={slot_race}") == 1
          and one(f"SELECT filled FROM volunteer_slots WHERE pk_slot_id={slot_race}") == 1, results)

    # rate limit: 10 posts per IP per 10 minutes
    rl_ip, codes = fake_ip(), []
    for _ in range(11):
        codes.append(call("POST", f"/api/public/volunteers/{tok}/signup", body=dict(person, consent=False), ip=rl_ip)[0])
    check("the public form is rate limited per IP", codes[:10] == [400] * 10 and codes[10] == 429, codes)

    # ── Hours roll into the project's man-hours ────────────────────────────────────────────────────────────────
    d = call("GET", f"{A}/{sheet}", t_a)[1]
    su = {x["name"]: x["id"] for s in d["slots"] for x in s["signups"]}
    member_su = next(x["id"] for s in d["slots"] for x in s["signups"] if x["memberId"] == plain)
    r = call("PUT", f"{A}/{sheet}/hours", t_a, {"entries": [{"signupId": member_su, "hours": 2.5},
                                                           {"signupId": su["E2E Visitor"], "hours": 3},
                                                           {"signupId": su["E2E Second"], "hours": 1.25}]})
    check("hours recorded per person", r[0] == 200 and r[1]["totalHours"] == 6.75 and r[1]["hoursApplied"] == 7, r)
    check("hours roll into the project's man-hours (10 + 7)", man_hours() == 17, man_hours())
    check("plain member cannot record hours", call("PUT", f"{A}/{sheet}/hours", t_plain, {"entries": []})[0] == 403)
    r = call("PUT", f"{A}/{sheet}/hours", t_a, {"entries": [{"signupId": member_su, "hours": 1000}]})
    check("hours are capped", r[0] == 400, r)
    racer_su = one(f"SELECT pk_signup_id FROM volunteer_signups WHERE fk_slot_id={slot_race}")
    r = call("PUT", f"{A}/{private}/hours", t_a, {"entries": [{"signupId": member_su, "hours": 1}]})
    check("a sign-up from another sheet is refused", r[0] == 400, r)
    r = call("PUT", f"{A}/{sheet}/hours", t_a, {"entries": [{"signupId": su["E2E Second"], "hours": None}]})
    check("clearing hours takes them back out (5.5 rounds to 6)", r[0] == 200 and man_hours() == 16, man_hours())
    keep = [{"id": s["id"], "task": s["task"], "startsAt": s["startsAt"], "endsAt": s["endsAt"], "capacity": s["capacity"]}
            for s in d["slots"]]
    r = call("PUT", f"{A}/{sheet}", t_a, dict(form, slots=[keep[0], dict(keep[1], capacity=1), keep[2]]))
    check("capacity cannot drop below the places taken", r[0] == 400 and "already has 2" in str(msg(r)), r)
    r = call("DELETE", f"{A}/{sheet}/signups/{su['E2E Visitor']}", t_a)
    check("removing a sign-up frees its place and takes its hours out", r[0] == 200 and man_hours() == 13
          and one(f"SELECT filled FROM volunteer_slots WHERE pk_slot_id={slot_b}") == 1, (r, man_hours()))
    check("other club's admin cannot remove sign-ups", call("DELETE", f"{A}/{sheet}/signups/{racer_su}", t_b)[0] == 403)

    # the hours follow the project link, and slots keep their sign-ups
    r = call("PUT", f"{A}/{sheet}", t_a, dict(form, yearId=None, projectId=None, slots=keep))
    check("unlinking the project takes the sheet's hours out", r[0] == 200 and man_hours() == 10, (r[0], man_hours()))
    r = call("PUT", f"{A}/{sheet}", t_a, dict(form, slots=keep))
    check("linking it again puts them back", r[0] == 200 and man_hours() == 13, (r[0], man_hours()))
    r = call("PUT", f"{A}/{sheet}", t_a, dict(form, slots=keep[1:]))
    check("a slot with sign-ups cannot be removed", r[0] == 400 and "cannot be removed" in str(msg(r)), r)

    # closing a sheet stops new sign-ups, not the reminders of the people already on it
    r = call("PUT", f"{A}/{sheet}", t_a, dict(form, status="closed", slots=keep))
    check("club closes the sheet to new sign-ups", r[0] == 200 and r[1]["status"] == "closed", r)
    check("a closed sheet's public link is 404", call("GET", f"/api/public/volunteers/{tok}")[0] == 404)
    check("members cannot sign up to a closed sheet", call("POST", f"/api/mobile/volunteers/slots/{slot_b}/signup", t_plain2)[0] == 404)
    r = call("GET", "/api/mobile/volunteers", t_plain)
    mine = next((s for s in r[1] if s["id"] == sheet), None) if r[0] == 200 else None
    check("the app still shows the member's own slot on a closed sheet", mine and [s["id"] for s in mine["slots"]] == [slot_a], r)

    # ── Reminders (email and the app's bell; the sheet above is closed) ────────────────────────────────────────
    r = call("POST", DU, t_a, {"meetingDate": str(date.today() + timedelta(days=1)), "duty": f"{MARK} greeter",
                                "memberId": plain, "note": "Welcome the guests at the door."})
    check("club admin assigns a meeting duty", r[0] == 200 and r[1]["memberName"], r)
    duty = r[1]["id"]
    member_reminded = duty_reminded = None
    for _ in range(50):
        member_reminded = one(f"SELECT COUNT(*) FROM volunteer_signups WHERE pk_signup_id={member_su} AND reminder_sent_at IS NOT NULL")
        duty_reminded = one(f"SELECT COUNT(*) FROM meeting_duties WHERE pk_duty_id={duty} AND reminder_sent_at IS NOT NULL")
        if member_reminded and duty_reminded:
            break
        time.sleep(3)
    check("the slot starting within 24 h gets its reminder", member_reminded == 1, member_reminded)
    check("the duty at tomorrow's meeting gets its reminder", duty_reminded == 1, duty_reminded)
    check("a slot three days away is not reminded yet",
          one(f"SELECT COUNT(*) FROM volunteer_signups WHERE fk_slot_id={slot_b} AND reminder_sent_at IS NOT NULL") == 0)
    sent = sql(f"SELECT status FROM email_log WHERE subject LIKE 'Reminder: {MARK}%' OR subject LIKE 'Meeting duty: {MARK}%'").split()
    check("reminder emails go through EmailService and email_log (no mail key here: none delivered)",
          len(sent) == 2 and all(s == "Failed" for s in sent), sent)
    r = call("GET", "/api/mobile/notifications?types=volunteer,meeting_duty&days=7", t_plain)
    items = r[1].get("items", []) if r[0] == 200 else []
    check("the member sees both reminders in the app's bell",
          any(i["type"] == "volunteer" and i["id"] == sheet for i in items) and any(i["type"] == "meeting_duty" and i["id"] == duty for i in items), r)

    # ── Speakers ───────────────────────────────────────────────────────────────────────────────────────────────
    week = str(date.today() + timedelta(days=7))
    speaker = {"meetingDate": week, "name": f"{MARK} Dr Asha Rao", "topic": "Clean water in schools",
               "bio": "Engineer and Rotary partner.", "email": "asha@example.org", "phone": "+44 20 7946 0000", "showOnWebsite": True}
    check("plain member cannot add speakers", call("POST", SP, t_plain, speaker)[0] == 403)
    check("a speaker needs a name", call("POST", SP, t_a, dict(speaker, name=" "))[0] == 400)
    check("a bad speaker email is refused", call("POST", SP, t_a, dict(speaker, email="nope"))[0] == 400)
    check("a bad phone number is refused", call("POST", SP, t_a, dict(speaker, phone="call me <b>"))[0] == 400)
    r = call("POST", SP, t_a, speaker)
    check("club admin schedules a speaker", r[0] == 200 and r[1]["email"] == "asha@example.org", r)
    sp1 = r[1]["id"]
    sp2 = call("POST", SP, t_a, dict(speaker, name=f"{MARK} Hidden Guest", showOnWebsite=False))[1]["id"]
    sp3 = call("POST", SP, t_a, dict(speaker, name=f"{MARK} Past Guest", meetingDate=str(date.today() - timedelta(days=1))))[1]["id"]
    r = upload(f"{SP}/{sp1}/photo", t_a, "speaker.png", png())
    photo = r[1].get("photoPath") if r[0] == 200 else None
    check("speaker photo upload", photo and os.path.isfile(os.path.join(WWWROOT, *photo.strip("/").split("/"))), r)
    r = upload(f"{SP}/{sp1}/photo", t_a, "fake.png", b"<html>not an image</html>")
    check("a file that is not an image is refused", r[0] == 400, r)
    r = call("GET", f"/api/public/club/{club_a}/speakers")
    names = [s["name"] for s in r[1]] if r[0] == 200 else []
    check("website shows coming speakers marked for it, without contact details",
          f"{MARK} Dr Asha Rao" in names and f"{MARK} Hidden Guest" not in names and f"{MARK} Past Guest" not in names
          and "asha@example.org" not in json.dumps(r[1]) and "phone" not in json.dumps(r[1]), r)
    r = call("GET", f"{SP}?from={date.today()}&to={date.today() + timedelta(days=30)}", t_a)
    feed = {s["name"] for s in r[1]} if r[0] == 200 else set()
    check("bulletin feed: the admin list for a date range, contacts included",
          {f"{MARK} Dr Asha Rao", f"{MARK} Hidden Guest"} <= feed and f"{MARK} Past Guest" not in feed, r)
    check("another club cannot edit this club's speaker",
          call("PUT", f"/api/clubs/{club_b}/speakers/{sp1}", t_b, speaker)[0] == 404)
    r = call("PUT", f"{SP}/{sp1}", t_a, dict(speaker, topic="Safe water for every school"))
    check("speaker updates", r[0] == 200 and r[1]["topic"] == "Safe water for every school", r)
    r = call("DELETE", f"{SP}/{sp1}", t_a)
    check("deleting a speaker removes the photo file", r[0] == 204
          and not os.path.exists(os.path.join(WWWROOT, *photo.strip("/").split("/"))), r)

    # ── Meeting duties ─────────────────────────────────────────────────────────────────────────────────────────
    r = call("POST", DU, t_a, {"meetingDate": week, "duty": f"{MARK} grace", "memberId": other})
    check("a duty goes to a member of this club only", r[0] == 400, r)
    r = call("GET", "/api/mobile/meeting-duties", t_plain)
    check("the app lists the member's own duties", r[0] == 200 and any(x["id"] == duty for x in r[1]), r)
    check("other members do not see it", all(x["id"] != duty for x in call("GET", "/api/mobile/meeting-duties", t_plain2)[1]))
    check("plain member cannot list the club's duties", call("GET", DU, t_plain)[0] == 403)
    check("another club's admin cannot delete it", call("DELETE", f"/api/clubs/{club_b}/meeting-duties/{duty}", t_b)[0] == 404)
    check("club admin removes the duty", call("DELETE", f"{DU}/{duty}", t_a)[0] == 204)

    # ── Deleting the sheet takes its hours out of the project ──────────────────────────────────────────────────
    check("other club's admin cannot delete the sheet", call("DELETE", f"{B}/{sheet}", t_b)[0] == 404)
    r = call("DELETE", f"{A}/{sheet}", t_a)
    check("sheet deleted, the project is back to its own man-hours", r[0] == 204 and man_hours() == 10
          and one(f"SELECT COUNT(*) FROM volunteer_slots WHERE fk_sheet_id={sheet}") == 0, (r, man_hours()))
finally:
    cleanup()
    call("PUT", "/api/features/volunteers", t_sa, {"enabled": flag_before == "1"})
    if flag_before == "":
        sql("DELETE FROM platform_features WHERE feature_key='volunteers'")
    left = one(f"SELECT (SELECT COUNT(*) FROM volunteer_sheets WHERE title LIKE '{MARK}%') + "
               f"(SELECT COUNT(*) FROM club_speakers WHERE name LIKE '{MARK}%') + (SELECT COUNT(*) FROM meeting_duties WHERE duty LIKE '{MARK}%')")
    check("cleanup left no test rows", left == 0, left)

print(f"{'ALL PASS' if not fails else f'{fails} FAILED'}")
sys.exit(1 if fails else 0)

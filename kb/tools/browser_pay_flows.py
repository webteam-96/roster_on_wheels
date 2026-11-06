"""Click-through in a real browser, Staging: create dues and an event link with no vendor split, a member pays through the
simulator, the report shows paid. Saves a screenshot on any failure.

    python kb/tools/browser_pay_flows.py <ui_base> <api_base> <mysql_port> <database> <screenshot_dir>

Environment: ROW_E2E_PASSWORD, ROW_E2E_PASSWORD_HASH (bcrypt of it, set on the admin of the copy). Needs Playwright, the admin
running against the API, and the API with ASPNETCORE_ENVIRONMENT=Staging, Payments__Provider=simulated,
Brand__Domains__AllowedOriginSuffixes__0=127.0.0.1, FrontendUrl=<ui_base>, Brevo__ApiUrl pointing at this script's fake Brevo
(http://127.0.0.1:5198/v3/smtp/email). Throwaway copies only: it replaces the admin's password and renames no one.
"""
import http.server, json, os, pathlib, subprocess, sys, threading, time, traceback, urllib.request
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

UI, API, PORT, DB, SHOTS = sys.argv[1].rstrip('/'), sys.argv[2].rstrip('/'), sys.argv[3], sys.argv[4], sys.argv[5]
assert "production" not in DB, "local copies only"
PASSWORD, HASH = os.environ["ROW_E2E_PASSWORD"], os.environ["ROW_E2E_PASSWORD_HASH"]
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
TAG = str(int(time.time()))[-6:]
fails = 0
pathlib.Path(SHOTS).mkdir(parents=True, exist_ok=True)


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q], capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:220]}"), flush=True)
    fails += 0 if ok else 1


class Brevo(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"messageId":"<browser@e2e.invalid>"}')

    def log_message(self, *a):
        pass


threading.Thread(target=http.server.HTTPServer(("127.0.0.1", 5198), Brevo).serve_forever, daemon=True).start()

admin_email = sql("""SELECT m.EmailId FROM member_roles r JOIN member_master_profile m ON m.pk_member_master_profile_id = r.fk_member_master_profile_id
    JOIN roles ro ON ro.pk_role_id = r.fk_role_id WHERE ro.RoleName = 'SuperAdmin' AND r.IsActive = 1 AND r.isdeleted = 0 AND m.isdeleted = 0 AND m.EmailId LIKE '%@%' LIMIT 1""")
admin_id = sql(f"SELECT pk_member_master_profile_id FROM member_master_profile WHERE EmailId = '{admin_email}' LIMIT 1")
sql(f"DELETE FROM member_credentials WHERE fk_member_master_profile_id = {admin_id}")
sql(f"INSERT INTO member_credentials (fk_member_master_profile_id, PasswordHash, IsTemporaryPassword) VALUES ({admin_id}, '{HASH}', 0)")

row = sql("""SELECT cm.fk_club_id, cm.fk_member_master_profile_id, m.EmailId, c.ClubName, d.DistrictNumber, d.pk_district_id
    FROM club_members cm JOIN member_master_profile m ON m.pk_member_master_profile_id = cm.fk_member_master_profile_id
    JOIN club_master c ON c.pk_club_id = cm.fk_club_id AND c.isdeleted = 0 AND c.IsActive = 1
    JOIN district_master d ON d.pk_district_id = c.fk_district_id AND d.isdeleted = 0 AND d.IsActive = 1
    WHERE cm.IsActive = 1 AND cm.isdeleted = 0 AND m.isdeleted = 0 AND COALESCE(cm.IsHonoraryMember, 0) = 0 AND m.EmailId LIKE '%@%.%'
      AND LENGTH(m.MemberName) > 3 AND m.pk_member_master_profile_id <> """ + admin_id + " LIMIT 1").split("\t")
club, member, email, club_name, district_number, district = row
sql(f"UPDATE member_master_profile SET MemberName = 'Browser Payer {TAG}' WHERE pk_member_master_profile_id = {member}")
PAYER = f"Browser Payer {TAG}"
year = sql("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1")
print(f"club {club}, member {member}, year {year}")


def shot(page, name):
    path = f"{SHOTS}/{name}.png"
    page.screenshot(path=path, full_page=True)
    return path


def pick(page, label, option):
    """Opens the select under this label and clicks the option."""
    field = page.locator(f"xpath=//label[contains(normalize-space(.), '{label}')]/following-sibling::*[.//button[@role='combobox'] or self::button[@role='combobox']][1]").first
    trigger = field if field.get_attribute("role") == "combobox" else field.locator("button[role=combobox]").first
    trigger.click()
    page.get_by_role("option", name=option).first.click()


def next_step(page):
    page.get_by_role("button", name="Next", exact=False).last.click()
    page.wait_for_timeout(700)


def login(page):
    page.goto(f"{UI}/login", wait_until="networkidle", timeout=240000)
    page.fill('input[type="email"]', admin_email)
    page.fill('input[type="password"]', PASSWORD)
    page.click('button[type="submit"]')
    page.wait_for_url(lambda u: "/login" not in u, timeout=240000)


def token_of(page):
    return page.evaluate("localStorage.getItem('auth_token')")


def api_get(path, tok):
    return json.load(urllib.request.urlopen(urllib.request.Request(API + path, headers={"Authorization": f"Bearer {tok}"}), timeout=30))


def otp_for(owner, member_email):
    for _ in range(20):
        code = sql(f"SELECT OtpCode FROM event_payment_otp WHERE fk_payment_link_id = {owner} AND Email = '{member_email}' ORDER BY pk_id DESC LIMIT 1")
        if code:
            return code
        time.sleep(0.5)
    return ""


def simulate_paid(page):
    page.wait_for_url("**/pay/simulated/**", timeout=90000)
    page.wait_for_selector("text=Simulated payment", timeout=60000)
    page.locator("button", has_text="Pay").first.click()
    # the simulated page sends the payer back to the flow's own thank-you page
    page.wait_for_url("**/thank-you**", timeout=90000)
    page.wait_for_load_state("networkidle", timeout=120000)


def dues_flow(ctx):
    page = ctx.new_page()
    purpose = f"Browser dues {TAG}"
    try:
        login(page)
        page.goto(f"{UI}/settings/membership-dues/create", wait_until="networkidle", timeout=240000)
        page.wait_for_selector("text=Create Club Dues", timeout=120000)
        check("dues form: no Vendor Splits step", page.get_by_text("Vendor Splits").count() == 0 or not page.get_by_text("Vendor Splits").first.is_visible())
        pick(page, "District", district_number)
        page.wait_for_timeout(1200)
        pick(page, "Club", club_name)
        pick(page, "Rotary Year", year)
        page.fill('input[placeholder="Title / Purpose of the dues"]', purpose)
        online = page.locator('input[name="modeOfPayment"][value="1"]')
        if online.count():
            online.check()
        next_step(page)
        page.wait_for_selector("text=Default", timeout=30000)
        amount = page.locator("xpath=//label[contains(., 'Amount *')]/following-sibling::input").first
        amount.fill("100")
        surcharge = page.locator("xpath=//label[contains(., 'Online Surcharge')]/following-sibling::input").first
        if surcharge.count():
            surcharge.fill("0")
        next_step(page)
        check("dues form: skips straight past vendor splits to the member list", page.get_by_text("Fee amount does not match").count() == 0)
        page.wait_for_timeout(2000)
        next_step(page)
        page.get_by_role("button", name="Create Club Dues").last.click()
        page.wait_for_url("**/settings/membership-dues**", timeout=60000)
        page.wait_for_timeout(1000)
        dues = sql(f"SELECT pk_membership_dues_id FROM membership_dues WHERE Purpose = '{purpose}' AND isdeleted = 0 ORDER BY 1 DESC LIMIT 1")
        check("dues created through the form", bool(dues), purpose)
        check("dues have no vendor rows", sql(f"SELECT COUNT(*) FROM membership_dues_vendors WHERE fk_membership_dues_id = {dues}") == "0")
        check("the member has a fee row", sql(f"SELECT COUNT(*) FROM membership_dues_member_fees WHERE fk_membership_dues_id = {dues} AND fk_member_profile_id = {member} AND isdeleted = 0") == "1")
        tok = token_of(page)
        key = next(r["payKey"] for r in api_get(f"/api/membership-dues?clubId={club}", tok) if str(r["id"]) == dues)

        payer = ctx.browser.new_context().new_page()
        payer.goto(f"{UI}/pay/dues/{dues}?k={key}", wait_until="networkidle", timeout=240000)
        payer.locator("input").first.fill(PAYER)
        payer.locator("button", has_text=PAYER).first.click(timeout=30000)
        payer.get_by_role("button", name="OTP", exact=False).first.click()
        payer.wait_for_timeout(2000)
        code = otp_for(dues, email)
        check("the OTP was issued to the email on record", bool(code))
        payer.locator('input[placeholder="Enter 6-digit OTP"]').fill(code)
        payer.get_by_role("button", name="Verify", exact=False).first.click()
        payer.wait_for_selector("text=/annual/i", timeout=60000)
        payer.locator("text=/annual/i").first.click()
        payer.wait_for_timeout(600)
        payer.get_by_role("button", name="Pay Online", exact=False).first.click()
        simulate_paid(payer)
        paid = sql(f"SELECT IsPaid FROM membership_dues_payments WHERE fk_membership_dues_id = {dues} AND fk_member_profile_id = {member} ORDER BY pk_id DESC LIMIT 1")
        check("the simulator marked the dues row paid", paid == "1", paid)
        check("the payer is back on the thank-you page", "/thank-you" in payer.url, payer.url)
        payer.context.close()

        page.goto(f"{UI}/report/dues/{dues}", wait_until="networkidle", timeout=240000)
        page.wait_for_selector(f"text={purpose}", timeout=120000)
        page.wait_for_timeout(1500)
        text = page.inner_text("body")
        rows = page.locator("tr", has_text=PAYER)
        check("the report lists the payer", rows.count() >= 1, text[:300])
        row_text = rows.first.inner_text() if rows.count() else ""
        check("the payer's row says Paid", "Paid" in row_text and "Unpaid" not in row_text, row_text[:200])
        check("the report totals one paid member and the amount", "Fully Paid: 1" in text.replace("
", " ") and "Total Collected: $100" in text.replace("
", " "), text[:300])
        shot(page, "r8_dues_report")
    except (PWTimeout, Exception):
        check("dues flow finished", False, next((l for l in traceback.format_exc().splitlines() if "Error" in l or "Timeout" in l), "")[:300] + " | " + traceback.format_exc()[-260:])
        print("screenshot:", shot(page, "r8_dues_failure"))
    finally:
        page.close()


def event_flow(ctx):
    page = ctx.new_page()
    title = f"Browser event {TAG}"
    try:
        login(page)
        page.goto(f"{UI}/settings/event-payment-links/create", wait_until="networkidle", timeout=240000)
        page.wait_for_selector("text=Form Type", timeout=120000)
        check("event form: no Vendor Splits step", not page.get_by_text("Vendor Splits").first.is_visible() if page.get_by_text("Vendor Splits").count() else True)
        check("event form: says 4 steps", page.get_by_text("of 4").count() >= 1)
        page.fill('input[placeholder="Event title"]', title)
        pick(page, "Select District", district_number)
        page.wait_for_timeout(1200)
        pick(page, "Select Club", club_name)
        next_step(page)
        next_step(page)
        page.fill('input[placeholder="e.g. Individual"]', "Delegate")
        page.fill('input[placeholder="1000"]', "25")
        page.get_by_role("button", name="Add", exact=False).first.click()
        page.wait_for_timeout(500)
        next_step(page)
        check("event form: skips straight past vendor splits to the last step", page.get_by_role("button", name="Create Link").count() >= 1)
        page.get_by_role("button", name="Create Link").last.click()
        page.wait_for_url("**/settings/event-payment-links**", timeout=60000)
        page.wait_for_timeout(1000)
        link = sql(f"SELECT pk_id FROM event_payment_links WHERE Title = '{title}' AND isdeleted = 0 ORDER BY 1 DESC LIMIT 1")
        check("event link created through the form", bool(link), title)
        check("event link has no vendor splits", sql(f"SELECT COUNT(*) FROM event_payment_vendor_splits WHERE fk_payment_link_id = {link}") == "0")
        tok = token_of(page)
        key = next(r["payKey"] for r in api_get(f"/api/event-payment-links?clubId={club}", tok) if str(r["id"]) == link)

        payer = ctx.browser.new_context().new_page()
        payer.goto(f"{UI}/pay/{link}?k={key}", wait_until="networkidle", timeout=240000)
        payer.locator("input").first.fill(PAYER)
        payer.locator("button", has_text=PAYER).first.click(timeout=30000)
        payer.get_by_role("button", name="OTP", exact=False).first.click()
        payer.wait_for_timeout(2000)
        code = otp_for(link, email)
        check("the event OTP was issued to the email on record", bool(code))
        payer.locator('input[placeholder="Enter 6-digit OTP"]').fill(code)
        payer.get_by_role("button", name="Verify", exact=False).first.click()
        payer.wait_for_selector("text=Select registration", timeout=60000)
        payer.locator("button[role=combobox]").first.click()
        payer.get_by_role("option", name="Delegate", exact=False).first.click()
        payer.wait_for_timeout(500)
        payer.get_by_role("button", name="Pay", exact=False).last.click()
        simulate_paid(payer)
        check("the payer is back on the event thank-you page", "/thank-you" in payer.url, payer.url)
        paid = sql(f"SELECT IsPaid FROM event_payment_members WHERE fk_payment_link_id = {link} AND fk_member_profile_id = {member} ORDER BY pk_id DESC LIMIT 1")
        check("the simulator marked the event row paid", paid == "1", paid)
        payer.context.close()

        page.goto(f"{UI}/report/{link}", wait_until="networkidle", timeout=240000)
        page.wait_for_selector(f"text={title}", timeout=120000)
        page.wait_for_timeout(1500)
        text = page.inner_text("body")
        check("the report lists the payer", PAYER in text, text[:300])
        check("the report counts one paid", "Total Paid: 1" in text.replace("\n", " "), text[:300])
        shot(page, "r8_event_report")
    except (PWTimeout, Exception):
        check("event flow finished", False, next((l for l in traceback.format_exc().splitlines() if "Error" in l or "Timeout" in l), "")[:300] + " | " + traceback.format_exc()[-260:])
        print("screenshot:", shot(page, "r8_event_failure"))
    finally:
        page.close()


with sync_playwright() as p:
    b = p.chromium.launch()
    dues_flow(b.new_context())
    event_flow(b.new_context())
    b.close()
print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)

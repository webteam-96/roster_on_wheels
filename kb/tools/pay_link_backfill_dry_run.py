"""Old pay links: lists what a one-off fix WOULD change and who a re-sent reminder WOULD reach. Changes nothing.

    python -I kb/tools/pay_link_backfill_dry_run.py <mysql_port> <database>

DRY RUN ONLY. Every query runs in a READ ONLY transaction. It has no way to send mail, never reads the JWT secret, and
writes nothing. Local copies only: restore production into a copy and point it there; it refuses a production database.
Addresses are masked because this output gets pasted around; the member id finds the person.
"""
import re, subprocess, sys

PORT, DB = sys.argv[1], sys.argv[2]
if "production" in DB.lower():
    sys.exit("Refused: run this on a local copy, never on production.")
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
PAY_LINK = re.compile(r"/pay/(dues/)?(\d+)(?:/?)(\?[^\s\"'<>]*)?")


def rows(query):
    run = subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "--batch", "-e",
                          f"START TRANSACTION READ ONLY; {query}; ROLLBACK;"],
                         capture_output=True, text=True, encoding="utf-8", check=True)
    return [line.split("\t") for line in run.stdout.splitlines()]


def mask(address):
    name, _, domain = address.partition("@")
    return f"{name[:2]}***@{domain}"


def plan_for(url, dues, events):
    """(action, new url or reason) for one stored link, or None when it is not a pay link."""
    match = PAY_LINK.search(url)
    if not match:
        return None
    is_dues, target, query = bool(match.group(1)), match.group(2), match.group(3) or ""
    if re.search(r"[?&]k=", query):
        return "keep", "already has a key"
    if re.search(r"[?&]token=", query):
        return "keep", "signed member link, still works"
    if is_dues:
        if target not in dues:
            return "skip", "dues deleted or closed"
    else:
        if target not in events:
            return "skip", "event link deleted or closed"
        if events[target] != "1":
            return "keep", "guest form, needs no key"
    joiner = "&" if query else "?"
    return "fix", url[:match.end()] + joiner + "k=<key made at run time>" + url[match.end():]


dues = {r[0]: r[1] for r in rows("SELECT pk_membership_dues_id, Purpose FROM membership_dues WHERE isdeleted=0 AND IsActive=1")}
events = {r[0]: r[1] for r in rows("SELECT pk_id, FormType FROM event_payment_links WHERE isdeleted=0 AND IsActive=1")}

print(f"DRY RUN on {DB}. Nothing was changed and no email was sent.\n")
fixes = 0
print("1. Stored links")
for table, key, column, deleted in (("weblinks", "pk_weblink_id", "LinkUrl", "isdeleted"), ("newsletters", "pk_newsletter_id", "LinkUrl", "isdeleted")):
    for row_id, url in rows(f"SELECT {key}, {column} FROM {table} WHERE COALESCE({deleted},0)=0 AND {column} LIKE '%/pay/%'"):
        plan = plan_for(url, dues, events)
        if plan is None:
            continue
        action, detail = plan
        fixes += action == "fix"
        print(f"   {action.upper():4} {table}.{row_id}  {url}")
        print(f"        {'->' if action == 'fix' else '  '} {detail}")
print(f"   {fixes} stored link(s) would be fixed.\n")

print("2. Reminders with a keyed link (active dues, unpaid, not honorary, has an email; same rules as the bulk reminder)")
reminders = rows("""
    SELECT md.pk_membership_dues_id, md.Purpose, m.pk_member_master_profile_id, m.EmailId
    FROM membership_dues md
    JOIN membership_dues_member_fees f ON f.fk_membership_dues_id = md.pk_membership_dues_id AND f.isdeleted = 0
    JOIN member_master_profile m ON m.pk_member_master_profile_id = f.fk_member_profile_id AND m.isdeleted = 0
    JOIN club_members cm ON cm.fk_member_master_profile_id = m.pk_member_master_profile_id AND cm.fk_club_id = md.fk_club_id
        AND cm.IsActive = 1 AND COALESCE(cm.isdeleted, 0) = 0 AND COALESCE(cm.IsHonoraryMember, 0) = 0
    LEFT JOIN (SELECT fk_member_fee_id,
                      SUM(FeeType = 1) AS annual, SUM(FeeType = 2) AS semi1, SUM(FeeType = 3) AS semi2
               FROM membership_dues_payments WHERE IsPaid = 1 AND isdeleted = 0 GROUP BY fk_member_fee_id) p ON p.fk_member_fee_id = f.pk_id
    WHERE md.isdeleted = 0 AND md.IsActive = 1 AND m.EmailId LIKE '%@%'
      AND COALESCE(p.annual, 0) = 0
      AND ((md.IsFees1 = 1 AND COALESCE(p.semi1, 0) = 0)
        OR (md.IsFees2 = 1 AND COALESCE(p.semi1, 0) = 0)
        OR (md.IsFees3 = 1 AND COALESCE(p.semi2, 0) = 0 AND MONTH(NOW()) BETWEEN 1 AND 6))
    ORDER BY md.pk_membership_dues_id, m.pk_member_master_profile_id""")
for dues_id, purpose, member_id, address in reminders:
    print(f"   WOULD SEND  dues {dues_id} ({purpose})  member {member_id}  {mask(address)}")
print(f"   {len(reminders)} email(s) would be sent, to {len({r[3].lower() for r in reminders})} address(es).\n")

print("3. Cannot be fixed by this script (already sent or free text; these people use the 'Email me a new link' page)")
sent = rows("SELECT COUNT(*) FROM club_mass_emails WHERE EmailBody LIKE '%/pay/%'")[0][0]
logged = rows("SELECT COUNT(*) FROM email_log WHERE body_html LIKE '%/pay/%' AND body_html NOT LIKE '%?k=%' AND body_html NOT LIKE '%token=%'")[0][0]
member_forms = sum(1 for form in events.values() if form == "1")
print(f"   {sent} club mass email(s) mention a pay link")
print(f"   {logged} logged email(s) carry a pay link with no key")
print(f"   {member_forms} active event member form(s): no list of who owes, so the admin re-shares the link from the event list")

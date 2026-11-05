"""The old pay link dry run lists the right links and people, and changes nothing.

    python -I kb/tools/pay_link_backfill_dry_run_e2e.py <api_base> <mysql_port> <database>
Local copies only. Seeds rows titled 'e2e-dry-run', runs the script, removes them. Prints the script's output as a sample.
"""
import pathlib, subprocess, sys

_, PORT, DB = sys.argv[1], sys.argv[2], sys.argv[3]
MYSQL = r"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
SCRIPT = pathlib.Path(__file__).resolve().parent / "pay_link_backfill_dry_run.py"
TITLE = "e2e-dry-run"
fails = 0


def sql(q):
    return subprocess.run([MYSQL, "-uroot", "-h127.0.0.1", f"-P{PORT}", DB, "-N", "-e", q],
                          capture_output=True, text=True, check=True).stdout.strip()


def check(name, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {str(detail)[:200]}"), flush=True)
    fails += 0 if ok else 1


def run(database=DB):
    return subprocess.run([sys.executable, "-I", str(SCRIPT), PORT, database], capture_output=True, text=True, encoding="utf-8")


def line_for(out, needle):
    return next((l for l in out.splitlines() if needle in l), "")


TABLES = "weblinks, newsletters, membership_dues, membership_dues_member_fees, membership_dues_payments, event_payment_links, email_log"


def fingerprint():
    return sql(f"CHECKSUM TABLE {TABLES}")


club, owes, paid = sql("""SELECT a.fk_club_id, a.fk_member_master_profile_id, b.fk_member_master_profile_id
    FROM club_members a JOIN club_members b ON b.fk_club_id = a.fk_club_id AND b.fk_member_master_profile_id <> a.fk_member_master_profile_id
    JOIN member_master_profile ma ON ma.pk_member_master_profile_id = a.fk_member_master_profile_id
    JOIN member_master_profile mb ON mb.pk_member_master_profile_id = b.fk_member_master_profile_id
    JOIN club_master c ON c.pk_club_id = a.fk_club_id AND c.isdeleted = 0
    WHERE a.IsActive=1 AND a.isdeleted=0 AND b.IsActive=1 AND b.isdeleted=0 AND ma.isdeleted=0 AND mb.isdeleted=0
      AND COALESCE(a.IsHonoraryMember,0)=0 AND COALESCE(b.IsHonoraryMember,0)=0
      AND ma.EmailId LIKE '%@%' AND mb.EmailId LIKE '%@%' LIMIT 1""").split()
email = sql(f"SELECT EmailId FROM member_master_profile WHERE pk_member_master_profile_id = {owes}")
district = sql(f"SELECT fk_district_id FROM club_master WHERE pk_club_id = {club}")
year = sql("SELECT YearLabel FROM rotary_year_master WHERE IsCurrent = 1 LIMIT 1")


def dues(active):
    return sql(f"""INSERT INTO membership_dues (fk_club_id, fk_district_id, RotaryYear, Purpose, OnlineSurchargePercent, ModeOfPayment, IsFees1, IsActive, isdeleted)
        VALUES ({club},{district},'{year}','{TITLE}',0,3,1,{active},0); SELECT LAST_INSERT_ID();""")


def event(form):
    return sql(f"INSERT INTO event_payment_links (Title, fk_club_id, FormType, IsActive, isdeleted) VALUES ('{TITLE}',{club},{form},1,0); SELECT LAST_INSERT_ID();")


def weblink(url):
    return sql(f"INSERT INTO weblinks (fk_club_id, Title, LinkUrl, IsActive, isdeleted) VALUES ({club},'{TITLE}','{url}',1,0); SELECT LAST_INSERT_ID();")


live, closed = dues(1), dues(0)
member_form, guest_form = event(1), event(2)
fee_owes = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount, Semi1Amount, Semi2Amount) VALUES ({live},{owes},100,0,0); SELECT LAST_INSERT_ID();")
fee_paid = sql(f"INSERT INTO membership_dues_member_fees (fk_membership_dues_id, fk_member_profile_id, AnnualAmount, Semi1Amount, Semi2Amount) VALUES ({live},{paid},100,0,0); SELECT LAST_INSERT_ID();")
payment = sql(f"""INSERT INTO membership_dues_payments (fk_membership_dues_id, fk_member_fee_id, fk_member_profile_id, FeeType, Amount, IsPaid, isdeleted)
    VALUES ({live},{fee_paid},{paid},1,100,1,0); SELECT LAST_INSERT_ID();""")
base = "https://row.example/admin"
links = {
    "old_dues": weblink(f"{base}/pay/dues/{live}"),
    "keyed": weblink(f"{base}/pay/dues/{live}?k=abc"),
    "signed": weblink(f"{base}/pay/dues/{live}?memberId=1&token=abc"),
    "closed": weblink(f"{base}/pay/dues/{closed}"),
    "old_event": weblink(f"{base}/pay/{member_form}"),
    "guest": weblink(f"{base}/pay/{guest_form}"),
    "other": weblink("https://row.example/about"),
}
ids = ",".join(links.values())

try:
    before = fingerprint()
    done = run()
    out = done.stdout
    print(out)
    check("it runs", done.returncode == 0, done.stderr)
    check("it says it is a dry run", out.startswith("DRY RUN"))
    check("an old dues link would be fixed", line_for(out, f"weblinks.{links['old_dues']} ").strip().startswith("FIX"), out)
    check("an old event member link would be fixed", line_for(out, f"weblinks.{links['old_event']} ").strip().startswith("FIX"))
    check("a keyed link is kept", line_for(out, f"weblinks.{links['keyed']} ").strip().startswith("KEEP"))
    check("a signed member link is kept", line_for(out, f"weblinks.{links['signed']} ").strip().startswith("KEEP"))
    check("a guest form link is kept", line_for(out, f"weblinks.{links['guest']} ").strip().startswith("KEEP"))
    check("a closed campaign's link is skipped", line_for(out, f"weblinks.{links['closed']} ").strip().startswith("SKIP"))
    check("a link that is not a pay link is not listed", f"weblinks.{links['other']} " not in out)
    check("no key is printed", "k=<key made at run time>" in out and "secret" not in out.lower())
    check("the member who owes would get a reminder", f"dues {live} ({TITLE})  member {owes} " in out)
    check("the member who paid would not", f"dues {live} ({TITLE})  member {paid} " not in out)
    check("addresses are masked", email not in out)
    check("no table changed", fingerprint() == before)
    refused = run("row_production")
    check("it refuses a production database", refused.returncode != 0 and "Refused" in (refused.stderr + refused.stdout))
finally:
    sql(f"DELETE FROM weblinks WHERE pk_weblink_id IN ({ids})")
    sql(f"DELETE FROM membership_dues_payments WHERE pk_id = {payment}")
    sql(f"DELETE FROM membership_dues_member_fees WHERE pk_id IN ({fee_owes},{fee_paid})")
    sql(f"DELETE FROM membership_dues WHERE pk_membership_dues_id IN ({live},{closed})")
    sql(f"DELETE FROM event_payment_links WHERE pk_id IN ({member_form},{guest_form})")

print("ALL PASS" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)

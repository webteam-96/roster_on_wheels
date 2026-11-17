"""Fill district_master.Timezone (IANA) where it is empty, from where the district's clubs are (2026-11-17).

Printed times (emails, receipts, exports) and club wall-clock times use the district's zone; every district's was
empty, so they showed UTC. Each club's zone comes from its country, and for countries with several zones from its
state; a district gets the zone most of its clubs are in (its own country when it has no clubs). A zone a district
admin already set is never changed.

    python -I row/database/maintenance/district_time_zones.py --host H --port P --user U --db D           # dry run
    python -I row/database/maintenance/district_time_zones.py --host H --port P --user U --db D --apply   # writes

Password from ROW_MIGRATION_DB_PASSWORD. Undo: UPDATE district_master SET Timezone = NULL WHERE pk_district_id IN (...)
with the ids this script prints (it only touches rows whose Timezone was empty).
"""
import argparse, collections, os, sys
import pymysql

COUNTRY = {
    "Afghanistan": "Asia/Kabul", "Albania": "Europe/Tirane", "Algeria": "Africa/Algiers",
    "American Samoa": "Pacific/Pago_Pago", "Andorra": "Europe/Andorra", "Angola": "Africa/Luanda",
    "Anguilla": "America/Anguilla", "Antigua and Barbuda": "America/Antigua", "Argentina": "America/Argentina/Buenos_Aires",
    "Armenia": "Asia/Yerevan", "Australia": "Australia/Sydney", "Austria": "Europe/Vienna", "Azerbaijan": "Asia/Baku",
    "Bahamas": "America/Nassau", "Bangladesh": "Asia/Dhaka", "Belarus": "Europe/Minsk", "Belgium": "Europe/Brussels",
    "Belize": "America/Belize", "Benin": "Africa/Porto-Novo", "Bermuda": "Atlantic/Bermuda", "Bolivia": "America/La_Paz",
    "Botswana": "Africa/Gaborone", "Brazil": "America/Sao_Paulo", "Brunei Darussalam": "Asia/Brunei",
    "Bulgaria": "Europe/Sofia", "Burundi": "Africa/Bujumbura", "Cambodia": "Asia/Phnom_Penh", "Canada": "America/Toronto",
    "Chile": "America/Santiago", "China, People's Republic of": "Asia/Shanghai", "Colombia": "America/Bogota",
    "Comoros": "Indian/Comoro", "Costa Rica": "America/Costa_Rica", "Croatia": "Europe/Zagreb",
    "Czech Republic": "Europe/Prague", "Denmark": "Europe/Copenhagen", "Dominican Republic": "America/Santo_Domingo",
    "Ecuador": "America/Guayaquil", "Egypt": "Africa/Cairo", "England": "Europe/London", "Eritrea": "Africa/Asmara",
    "Estonia": "Europe/Tallinn", "Finland": "Europe/Helsinki", "France": "Europe/Paris", "Germany": "Europe/Berlin",
    "Ghana": "Africa/Accra", "Greece": "Europe/Athens", "Guam": "Pacific/Guam", "Hungary": "Europe/Budapest",
    "Iceland": "Atlantic/Reykjavik", "India": "Asia/Kolkata", "Indonesia": "Asia/Jakarta", "Iraq": "Asia/Baghdad",
    "Ireland": "Europe/Dublin", "Israel": "Asia/Jerusalem", "Italy": "Europe/Rome", "Japan": "Asia/Tokyo",
    "Kenya": "Africa/Nairobi", "Korea, Republic of": "Asia/Seoul", "Lao People's Democratic Republic": "Asia/Vientiane",
    "Latvia": "Europe/Riga", "Lesotho": "Africa/Maseru", "Liberia": "Africa/Monrovia", "Liechtenstein": "Europe/Vaduz",
    "Lithuania": "Europe/Vilnius", "Malawi": "Africa/Blantyre", "Malaysia": "Asia/Kuala_Lumpur",
    "Mexico": "America/Mexico_City", "Moldova": "Europe/Chisinau", "Montenegro": "Europe/Podgorica",
    "Nepal": "Asia/Kathmandu", "Netherlands": "Europe/Amsterdam", "New Caledonia": "Pacific/Noumea",
    "New Zealand": "Pacific/Auckland", "Nigeria": "Africa/Lagos", "North Macedonia": "Europe/Skopje",
    "Norway": "Europe/Oslo", "Pakistan": "Asia/Karachi", "Peru": "America/Lima", "Philippines": "Asia/Manila",
    "Poland": "Europe/Warsaw", "Portugal": "Europe/Lisbon", "Puerto Rico": "America/Puerto_Rico",
    "Russian Federation": "Europe/Moscow", "Scotland": "Europe/London", "Spain": "Europe/Madrid",
    "Sri Lanka": "Asia/Colombo", "Sweden": "Europe/Stockholm", "Switzerland": "Europe/Zurich", "Taiwan": "Asia/Taipei",
    "Tanzania, United Republic of": "Africa/Dar_es_Salaam", "Thailand": "Asia/Bangkok", "Turkey": "Europe/Istanbul",
    "Uganda": "Africa/Kampala", "Ukraine": "Europe/Kyiv", "United States": "America/New_York", "Uruguay": "America/Montevideo",
    "Venezuela": "America/Caracas", "Wales": "Europe/London",
    "Papua New Guinea": "Pacific/Port_Moresby", "Solomon Islands": "Pacific/Guadalcanal",
}

US = {**{s: "America/New_York" for s in "CT DE DC FL GA ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV IN KY".split()},
      **{s: "America/Chicago" for s in "AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI".split()},
      **{s: "America/Denver" for s in "CO MT NM UT WY ID".split()},
      "AZ": "America/Phoenix", "CA": "America/Los_Angeles", "NV": "America/Los_Angeles", "OR": "America/Los_Angeles",
      "WA": "America/Los_Angeles", "AK": "America/Anchorage", "HI": "Pacific/Honolulu"}
CA = {"ON": "America/Toronto", "QC": "America/Toronto", "BC": "America/Vancouver", "AB": "America/Edmonton",
      "SK": "America/Regina", "MB": "America/Winnipeg", "NB": "America/Halifax", "NS": "America/Halifax",
      "PE": "America/Halifax", "NL": "America/St_Johns", "YT": "America/Whitehorse", "NT": "America/Yellowknife",
      "NU": "America/Iqaluit"}
BR = {"AM": "America/Manaus", "RO": "America/Porto_Velho", "RR": "America/Boa_Vista", "AC": "America/Rio_Branco",
      "MT": "America/Cuiaba", "MS": "America/Campo_Grande", "PA": "America/Belem", "AP": "America/Belem",
      "CE": "America/Fortaleza", "PI": "America/Fortaleza", "MA": "America/Fortaleza", "RN": "America/Fortaleza",
      "PB": "America/Fortaleza", "PE": "America/Recife", "AL": "America/Maceio", "SE": "America/Maceio",
      "BA": "America/Bahia", "TO": "America/Araguaina"}
AU = {"NSW": "Australia/Sydney", "ACT": "Australia/Sydney", "VIC": "Australia/Melbourne", "TAS": "Australia/Hobart",
      "QLD": "Australia/Brisbane", "SA": "Australia/Adelaide", "NT": "Australia/Darwin", "WA": "Australia/Perth"}
MX = {"BC": "America/Tijuana", "BCN": "America/Tijuana", "BCS": "America/Mazatlan", "SIN": "America/Mazatlan",
      "NAY": "America/Mazatlan", "NAYARIT": "America/Mazatlan", "SON": "America/Hermosillo", "CHIH": "America/Chihuahua",
      "QROO": "America/Cancun"}
ID_MAKASSAR = ("BALI", "MATARAM", "SULAWESI", "NUSSA", "NUSA")


def key(state):  # "N.S.W." / "S.P." / "Q. Roo" -> "NSW" / "SP" / "QROO"
    return "".join(ch for ch in (state or "").upper() if ch.isalnum())


def club_zone(country, state):
    country = (country or "").strip()
    k = key(state)
    if country == "United States": return US.get(k) or (None if k else COUNTRY[country])
    if country == "Canada": return CA.get(k) or US.get(k) or (None if k else COUNTRY[country])  # border districts list US states
    if country == "Brazil": return BR.get(k, "America/Sao_Paulo")
    if country == "Australia":
        if "HIGHLANDS" in k or "NEWBRITAIN" in k: return "Pacific/Port_Moresby"
        if k == "GUADALCANAL": return "Pacific/Guadalcanal"
        return AU.get(k) or (None if k else COUNTRY[country])
    if country == "Mexico": return MX.get(k, "America/Mexico_City")
    if country == "Indonesia": return "Asia/Makassar" if any(w in k for w in ID_MAKASSAR) else "Asia/Jakarta"
    return COUNTRY.get(country)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", required=True); ap.add_argument("--port", type=int, default=3306)
    ap.add_argument("--user", required=True); ap.add_argument("--db", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    conn = pymysql.connect(host=a.host, port=a.port, user=a.user, password=os.environ.get("ROW_MIGRATION_DB_PASSWORD", ""),
                           database=a.db, autocommit=False, connect_timeout=15)
    cur = conn.cursor()
    cur.execute("SELECT pk_district_id, DistrictNumber, TRIM(Country) FROM district_master "
                "WHERE Timezone IS NULL OR TRIM(Timezone) = ''")
    districts = cur.fetchall()
    cur.execute("SELECT fk_district_id, Country, State FROM club_master WHERE isdeleted = 0")
    votes = collections.defaultdict(collections.Counter)
    for did, country, state in cur.fetchall():
        z = club_zone(country, state)
        if z: votes[did][z] += 1
    plan, unknown = [], []
    for did, number, country in districts:
        z = votes[did].most_common(1)[0][0] if votes[did] else club_zone(country, None)
        (plan if z else unknown).append((did, number, country, z))
    print(f"{len(districts)} districts without a zone: {len(plan)} resolved, {len(unknown)} left empty")
    for did, number, country, _ in unknown:
        print(f"  no zone found: district {number} (id {did}, country {country!r})")
    print("Zones:", dict(collections.Counter(z for *_, z in plan).most_common()))
    if not a.apply:
        print("Dry run: nothing changed. Re-run with --apply.")
        return
    cur.executemany("UPDATE district_master SET Timezone = %s WHERE pk_district_id = %s "
                    "AND (Timezone IS NULL OR TRIM(Timezone) = '')", [(z, did) for did, _, _, z in plan])
    conn.commit()
    print(f"Set the zone of {len(plan)} districts. Ids: {','.join(str(d) for d, *_ in plan)}")


if __name__ == "__main__":
    main()

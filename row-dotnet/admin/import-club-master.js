// One-time importer — reads club_master.xlsx from the project root,
// converts Excel serial dates/times, and emits a ready-to-run SQL file
// (club_master_import.sql) that INSERTs all rows into club_master with
// the original pk_club_id preserved.
//
// Usage:
//   cd rotary-frontend
//   node import-club-master.js
//
// Output: club_master_import.sql in the same folder.
// Then run that SQL in MySQL Workbench against your DB.

const XLSX = require("xlsx-js-style");
const fs = require("fs");
const path = require("path");

const EXCEL_PATH = path.join(__dirname, "..", "club_master.xlsx");
const OUT_PATH = path.join(__dirname, "club_master_import.sql");
const BATCH_SIZE = 200;

const COLUMNS = [
  "pk_club_id", "fk_district_id", "ClubRotaryId", "ClubName", "Timezone",
  "ClubCharterDate", "ClubLogoPath", "ClubWebsite",
  "MeetingDay", "MeetingFromTime", "MeetingToTime", "MeetingAddress",
  "Country", "State", "City", "Pincode",
  "ActiveFromDate", "ActiveToDate",
  "IsAutomaticMeetingReminder", "IsFamilyLogin", "IsActive",
  "created_by", "created_date", "modified_by", "modified_date",
  "isdeleted", "deleted_by", "deleted_date",
  "BirthdayGreeting", "IsEnableBirthdayNotification",
  "AnniversaryGreeting", "IsEnableAnniversaryNotification",
  "IsGreetingSendWhatsapp", "IsGreetingSendEmail",
  "IsEnableBirthdayEmail", "BirthdayEmailFrom", "BirthdayEmailSubject", "BirthdayEmailMessage",
  "IsEnableAnniversaryEmail", "AnniversaryEmailFrom", "AnniversaryEmailSubject", "AnniversaryEmailMessage",
  "Is_healthy_club", "Latitude", "Longitude", "ROW_as_vendor_selected",
];

const COL_TYPE = {
  pk_club_id: "int", fk_district_id: "int",
  ClubRotaryId: "str", ClubName: "str", Timezone: "str",
  ClubCharterDate: "date",
  ClubLogoPath: "str", ClubWebsite: "str",
  MeetingDay: "str", MeetingFromTime: "time", MeetingToTime: "time", MeetingAddress: "str",
  Country: "str", State: "str", City: "str", Pincode: "str",
  ActiveFromDate: "date", ActiveToDate: "date",
  IsAutomaticMeetingReminder: "bool", IsFamilyLogin: "bool", IsActive: "bool",
  created_by: "int", created_date: "datetime",
  modified_by: "int", modified_date: "datetime",
  isdeleted: "int", deleted_by: "int", deleted_date: "datetime",
  BirthdayGreeting: "str", IsEnableBirthdayNotification: "bool",
  AnniversaryGreeting: "str", IsEnableAnniversaryNotification: "bool",
  IsGreetingSendWhatsapp: "bool", IsGreetingSendEmail: "bool",
  IsEnableBirthdayEmail: "bool", BirthdayEmailFrom: "str", BirthdayEmailSubject: "str", BirthdayEmailMessage: "str",
  IsEnableAnniversaryEmail: "bool", AnniversaryEmailFrom: "str", AnniversaryEmailSubject: "str", AnniversaryEmailMessage: "str",
  Is_healthy_club: "str", Latitude: "str", Longitude: "str",
  ROW_as_vendor_selected: "bool",
};

function excelSerialToJsDate(serial) {
  if (typeof serial !== "number" || !isFinite(serial)) return null;
  if (serial < 1) return null;
  const ms = (serial - 25569) * 86400 * 1000;
  return new Date(ms);
}

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtDate(d) { return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
function fmtDateTime(d) { return fmtDate(d) + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds()); }

function isNullish(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return true;
    if (/^01\/01\/1753/.test(t)) return true;
  }
  return false;
}

function sqlEscape(s) {
  const str = String(s);
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    if (ch === 0) continue; // strip null bytes
    const c = str[i];
    if (c === "\\") out += "\\\\";
    else if (c === "'") out += "''";
    else if (c === "\r") out += "\\r";
    else if (c === "\n") out += "\\n";
    else out += c;
  }
  return "'" + out + "'";
}

function render(col, raw) {
  const type = COL_TYPE[col];
  if (isNullish(raw)) return "NULL";

  if (type === "date") {
    if (typeof raw === "number") {
      const d = excelSerialToJsDate(raw);
      return d ? sqlEscape(fmtDate(d)) : "NULL";
    }
    const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return sqlEscape(m[1] + "-" + m[2] + "-" + m[3]);
    const m2 = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m2) return sqlEscape(m2[3] + "-" + pad2(+m2[2]) + "-" + pad2(+m2[1]));
    return "NULL";
  }
  if (type === "datetime") {
    if (typeof raw === "number") {
      const d = excelSerialToJsDate(raw);
      return d ? sqlEscape(fmtDateTime(d)) : "NULL";
    }
    return "NULL";
  }
  if (type === "time") {
    if (typeof raw === "number") {
      if (raw === 0) return "NULL";
      const totalSec = Math.round(raw * 86400);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      return sqlEscape(pad2(h) + ":" + pad2(m) + ":" + pad2(s));
    }
    return "NULL";
  }
  if (type === "int") {
    if (typeof raw === "number") return String(Math.trunc(raw));
    const n = parseInt(String(raw), 10);
    return isNaN(n) ? "NULL" : String(n);
  }
  if (type === "bool") {
    if (raw === 1 || raw === "1" || raw === true) return "1";
    if (raw === 0 || raw === "0" || raw === false) return "0";
    return "0";
  }
  return sqlEscape(String(raw));
}

// --- Main ---
console.log("Reading:", EXCEL_PATH);
if (!fs.existsSync(EXCEL_PATH)) {
  console.error("File not found:", EXCEL_PATH);
  process.exit(1);
}

const wb = XLSX.readFile(EXCEL_PATH);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true });
console.log("Total rows:", rows.length);

const colList = COLUMNS.map((c) => "`" + c + "`").join(", ");
let sql = "";
sql += "-- One-time club_master import (auto-generated).\n";
sql += "-- FK checks disabled: fk_district_id values may not all match new district_master.\n";
sql += "SET FOREIGN_KEY_CHECKS = 0;\n";
sql += "SET UNIQUE_CHECKS = 0;\n\n";

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  sql += "INSERT INTO club_master (" + colList + ") VALUES\n";
  const valueRows = batch.map((r) =>
    "  (" + COLUMNS.map((c) => render(c, r[c])).join(", ") + ")"
  );
  sql += valueRows.join(",\n") + ";\n\n";
}

sql += "SET FOREIGN_KEY_CHECKS = 1;\n";
sql += "SET UNIQUE_CHECKS = 1;\n\n";
sql += "-- Bump auto-increment so future inserts don't collide\n";
sql += "ALTER TABLE club_master AUTO_INCREMENT = 100000;\n";

fs.writeFileSync(OUT_PATH, sql, "utf8");
console.log("Wrote:", OUT_PATH);
console.log("Size:", Math.round(fs.statSync(OUT_PATH).size / 1024), "KB");
console.log("Open this file in MySQL Workbench and run it against your DB.");

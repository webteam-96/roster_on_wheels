#!/usr/bin/env node
// Applies .sql files (mysqldump output with DELIMITER blocks included) to the
// database in ConnectionStrings__DefaultConnection, statement by statement.
//
//   ConnectionStrings__DefaultConnection="Server=...;Port=3306;Database=row;User=...;Password=..." \
//     node scripts/apply-sql.mjs database/schema.sql database/schema-drift.sql
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

function parseConnectionString(cs) {
  const map = {};
  for (const part of cs.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) map[part.slice(0, i).trim().toLowerCase().replace(/\s+/g, "")] = part.slice(i + 1).trim();
  }
  return {
    host: map.server ?? map.host ?? map.datasource ?? "127.0.0.1",
    port: Number(map.port ?? 3306),
    database: map.database ?? map.initialcatalog,
    user: map.user ?? map.userid ?? map.uid ?? map.username,
    password: map.password ?? map.pwd ?? "",
  };
}

/** Split on the current delimiter, honouring DELIMITER lines, quotes and comments. */
function* statements(sql) {
  let delimiter = ";";
  let buf = "";
  for (const line of sql.split(/\r?\n/)) {
    const m = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);
    if (m) {
      if (buf.trim()) yield buf;
      buf = "";
      delimiter = m[1];
      continue;
    }
    buf += line + "\n";
    if (line.trimEnd().endsWith(delimiter) && !inString(buf)) {
      const stmt = buf.trimEnd().slice(0, -delimiter.length);
      if (stmt.trim()) yield stmt;
      buf = "";
    }
  }
  if (buf.trim()) yield buf;
}

/** True when the text ends inside a quoted string (so a delimiter there is data). */
function inString(text) {
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === "\\") i++;
      else if (ch === q) q = null;
    } else if (ch === "'" || ch === '"' || ch === "`") q = ch;
    else if (ch === "-" && text[i + 1] === "-" && (text[i + 2] === " " || text[i + 2] === "\t")) i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i);
  }
  return q !== null;
}

const files = process.argv.slice(2);
const cs = process.env.ConnectionStrings__DefaultConnection;
if (!files.length || !cs) {
  console.error("usage: ConnectionStrings__DefaultConnection=... node scripts/apply-sql.mjs <file.sql>...");
  process.exit(2);
}
const conn = await mysql.createConnection({ ...parseConnectionString(cs), multipleStatements: false, charset: "utf8mb4" });
try {
  for (const file of files) {
    let n = 0;
    for (const stmt of statements(readFileSync(file, "utf8"))) {
      try {
        await conn.query(stmt);
        n++;
      } catch (e) {
        console.error(`${file}: statement ${n + 1} failed: ${e.message}\n${stmt.slice(0, 300)}`);
        process.exitCode = 1;
        throw e;
      }
    }
    console.log(`${file}: ${n} statement(s) applied`);
  }
} finally {
  await conn.end();
}

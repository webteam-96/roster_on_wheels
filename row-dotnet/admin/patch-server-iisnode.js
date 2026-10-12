// Run AFTER `next build` to make the standalone server.js iisnode-compatible.
//   node patch-server-iisnode.js <path-to-server.js>
// Default path: .next/standalone/server.js
//
// What it fixes: iisnode sets process.env.PORT to a named pipe (\\.\pipe\xxx),
// but Next.js standalone does parseInt(PORT) → NaN → falls back to 3000 → EACCES.
// We detect the pipe and pass it as a string + clear the hostname.

const fs = require("fs");
const path = require("path");

const target = process.argv[2] || path.join(__dirname, ".next", "standalone", "server.js");
if (!fs.existsSync(target)) {
  console.error("server.js not found at:", target);
  process.exit(1);
}

let src = fs.readFileSync(target, "utf8");
if (src.includes("// iisnode-patched")) {
  console.log("Already patched:", target);
  process.exit(0);
}

const oldBlock =
  "const currentPort = parseInt(process.env.PORT, 10) || 3000\n" +
  "const hostname = process.env.HOSTNAME || '0.0.0.0'";

const newBlock =
  "// iisnode-patched\n" +
  "const _portEnv = process.env.PORT\n" +
  "const currentPort = _portEnv && isNaN(Number(_portEnv)) ? _portEnv : (parseInt(_portEnv, 10) || 3000)\n" +
  "const hostname = (_portEnv && isNaN(Number(_portEnv))) ? undefined : (process.env.HOSTNAME || '0.0.0.0')";

if (!src.includes(oldBlock)) {
  console.error("Could not find the expected currentPort/hostname block. Manual patch required.");
  process.exit(2);
}

src = src.replace(oldBlock, newBlock);
fs.writeFileSync(target, src);
console.log("Patched:", target);

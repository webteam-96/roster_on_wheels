const { createServer } = require("http");
const { parse } = require("url");
const path = require("path");

process.env.NODE_ENV = "production";
process.chdir(__dirname);

const next = require("next");
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

const port = process.env.PORT || 3000;

app.prepare().then(() => {
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, () => {
    console.log("Next.js ready on port " + port);
  });
}).catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

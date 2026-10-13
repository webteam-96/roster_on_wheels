// Generates messages/en-XA/*.json from messages/en/*.json (master plan WS2-04).
// Each string is wrapped in ⟦ ⟧, vowels are accented and the text is padded by
// about 40 percent, so untranslated text (no brackets) and clipped text show up.
// ICU arguments, plural/select bodies' syntax and rich-text tags are untouched.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const ACCENTS = { a: "á", e: "é", i: "í", o: "ö", u: "ü", A: "Á", E: "É", I: "Í", O: "Ö", U: "Ü", y: "ý", Y: "Ý" };

// Accents literal text only. Argument names, types, plural/select keywords,
// "#", quoted ICU escapes and <tag> names are copied unchanged.
function accent(text) {
  let i = 0;

  // Literal text until an unmatched "}" (the end of a plural/select option) or the end.
  function literal() {
    let out = "";
    while (i < text.length) {
      const c = text[i];
      if (c === "}") return out;
      if (c === "{") out += argument();
      else if (c === "<") {
        const close = text.indexOf(">", i);
        const to = close === -1 ? text.length : close + 1;
        out += text.slice(i, to);
        i = to;
      } else if (c === "'") {
        const close = text.indexOf("'", i + 1);
        const to = close === -1 ? text.length : close + 1;
        out += text.slice(i, to);
        i = to;
      } else {
        out += ACCENTS[c] ?? c;
        i++;
      }
    }
    return out;
  }

  // "{name}", "{n, number}", "{count, plural, one {…} other {…}}"
  function argument() {
    const head = /^\{\s*[^,}]+\s*(,\s*(\w+)\s*)?/.exec(text.slice(i));
    let out = head[0];
    i += head[0].length;
    const type = head[2];
    if (type === "plural" || type === "select" || type === "selectordinal") {
      out += text[i] === "," ? text[i++] : "";
      while (i < text.length && text[i] !== "}") {
        const open = text.indexOf("{", i);
        out += text.slice(i, open + 1); // selector, e.g. " one " or " =0 " or " offset:1 other "
        i = open + 1;
        out += literal();
        out += text[i++]; // the option's "}"
      }
    } else {
      // simple argument or one with a format style: copy to the closing brace
      while (i < text.length && text[i] !== "}") out += text[i++];
    }
    out += text[i++] ?? ""; // the argument's "}"
    return out;
  }

  return literal();
}

function pseudo(value) {
  if (typeof value !== "string") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pseudo(v)]));
  }
  const pad = "~".repeat(Math.max(1, Math.round(value.length * 0.4)));
  return `⟦${accent(value)}${pad}⟧`;
}

mkdirSync(join(root, "en-XA"), { recursive: true });
const files = readdirSync(join(root, "en")).filter((f) => f.endsWith(".json"));
for (const file of files) {
  const english = JSON.parse(readFileSync(join(root, "en", file), "utf8"));
  writeFileSync(join(root, "en-XA", file), JSON.stringify(pseudo(english), null, 2) + "\n");
}
console.log(`i18n:pseudo wrote ${files.length} namespace(s) to messages/en-XA`);

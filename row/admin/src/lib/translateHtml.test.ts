import { describe, expect, it } from "vitest";
import { chunkText, translateHtml, translateText } from "./translateHtml";

const upper = async (q: string[]) => q.map((s) => s.toUpperCase());

describe("chunkText", () => {
  it("keeps short text whole", () => {
    expect(chunkText("  Hello world.  ")).toEqual(["Hello world."]);
  });

  it("splits long text at sentence ends, never over the limit", () => {
    const text = "One two three. Four five six. Seven eight nine.";
    const pieces = chunkText(text, 20);
    expect(pieces).toEqual(["One two three.", "Four five six.", "Seven eight nine."]);
    expect(pieces.every((p) => p.length <= 20)).toBe(true);
  });

  it("falls back to spaces, then to a hard cut", () => {
    expect(chunkText("aaaa bbbb cccc", 9)).toEqual(["aaaa bbbb", "cccc"]);
    expect(chunkText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
});

describe("translateHtml", () => {
  it("translates text between tags and keeps the tags", async () => {
    const html = '<h2>Our story</h2><p>We meet <a href="/m/x">every week</a>.</p>';
    expect(await translateHtml(html, upper)).toBe('<h2>OUR STORY</h2><p>WE MEET <a href="/m/x">EVERY WEEK</a>.</p>');
  });

  it("decodes entities for the provider and escapes the answer", async () => {
    expect(await translateHtml("<p>Fish &amp; chips</p>", async (q) => q.map((s) => `${s} <ok>`))).toBe("<p>Fish &amp; chips &lt;ok&gt;</p>");
  });

  it("sends one batch and leaves markup-only input alone", async () => {
    const calls: string[][] = [];
    const spy = async (q: string[]) => { calls.push(q); return q; };
    await translateHtml("<p>One</p><p>Two</p>", spy);
    expect(calls).toEqual([["One", "Two"]]);
    expect(await translateHtml("<p><br></p>", spy)).toBe("<p><br></p>");
    expect(calls).toHaveLength(1);
  });

  it("keeps the original where the provider gives nothing back", async () => {
    expect(await translateHtml("<p>Hello</p>", async () => [])).toBe("<p>Hello</p>");
  });
});

describe("translateText", () => {
  it("joins the translated pieces", async () => {
    expect(await translateText("Hello there.", upper)).toBe("HELLO THERE.");
    expect(await translateText("", upper)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { CLUB_NAME_FILTER, MEMBER_NAME_FILTER, TEXT_INPUT_REGEX, sanitizeText } from "./textInput";

// One sample per ROW launch language (master plan section 1.3).
const LANGUAGES: Record<string, string> = {
  English: "Club Meeting: Annual Report (2026) - 50% done!",
  French: "Réunion du Club « Été » à 19h, coût 20 €",
  German: "Großes Treffen für Mitglieder, Übersicht",
  Italian: "Attività del club, perché è importante",
  Japanese: "例会のお知らせ：第３回、会費は¥1,000です。",
  Korean: "정기 모임 안내 – 회비 ₩10,000",
  Portuguese: "Ação Comunitária em São Paulo, inscrições abertas",
  Spanish: "Reunión del año: ¿Vienes? ¡Sí, señor!",
};

describe("TEXT_INPUT_REGEX", () => {
  for (const [language, text] of Object.entries(LANGUAGES)) {
    it(`accepts ${language}`, () => {
      expect(TEXT_INPUT_REGEX.test(text)).toBe(true);
    });
  }

  it("accepts line breaks, an empty value and currency symbols", () => {
    expect(TEXT_INPUT_REGEX.test("Line one\nLine two\r\n\tTabbed")).toBe(true);
    expect(TEXT_INPUT_REGEX.test("")).toBe(true);
    expect(TEXT_INPUT_REGEX.test("₹ $ € £ ¥ ₩")).toBe(true);
  });

  it.each([
    ["smiley", "Great meeting 😀"],
    ["heart", "Thanks ❤️"],
    ["thumbs up with skin tone", "Well done 👍🏽"],
    ["family (joined emoji)", "Family day 👨‍👩‍👧"],
    ["flag", "Welcome 🇫🇷"],
    ["keycap", "Step 1️⃣"],
    ["rocket", "🚀 Launch"],
  ])("refuses emoji: %s", (_name, text) => {
    expect(TEXT_INPUT_REGEX.test(text)).toBe(false);
  });

  it("still accepts plain digits, # and * (they are not emoji on their own)", () => {
    expect(TEXT_INPUT_REGEX.test("Room #12 * 3")).toBe(true);
  });
});

describe("sanitizeText", () => {
  it("keeps accented and non-Latin letters as typed", () => {
    expect(sanitizeText("José García")).toBe("José García");
    expect(sanitizeText("例会のお知らせ")).toBe("例会のお知らせ");
    expect(sanitizeText("정기 모임")).toBe("정기 모임");
  });

  it("joins a letter typed with a separate accent", () => {
    expect(sanitizeText("Réunion")).toBe("Réunion");
  });

  it("drops emoji but keeps the text around them", () => {
    expect(sanitizeText("Great 😀 meeting 👍🏽")).toBe("Great  meeting ");
    expect(sanitizeText("Family 👨‍👩‍👧 day")).toBe("Family  day");
  });

  it("turns Word / PDF look-alikes into plain characters", () => {
    expect(sanitizeText("“Quote” — it’s…")).toBe('"Quote" - it\'s...');
    expect(sanitizeText("a b​c")).toBe("a bc");
    expect(sanitizeText("© 2026 ROW™")).toBe("(c) 2026 ROW(tm)");
  });

  it("keeps line breaks and returns an empty string for empty input", () => {
    expect(sanitizeText("one\ntwo")).toBe("one\ntwo");
    expect(sanitizeText("")).toBe("");
  });
});

describe("MEMBER_NAME_FILTER", () => {
  const clean = (s: string) => s.replace(MEMBER_NAME_FILTER, "");

  it("keeps names in any language and the dot", () => {
    expect(clean("Dr. Rajesh P. Shah")).toBe("Dr. Rajesh P. Shah");
    expect(clean("José García")).toBe("José García");
    expect(clean("Jürgen Müller")).toBe("Jürgen Müller");
    expect(clean("山田 太郎")).toBe("山田 太郎");
    expect(clean("김민준")).toBe("김민준");
  });

  it("removes digits and emoji", () => {
    expect(clean("Anna 2 😀")).toBe("Anna  ");
  });
});

describe("CLUB_NAME_FILTER", () => {
  const clean = (s: string) => s.replace(CLUB_NAME_FILTER, "");

  it("keeps club names in any language", () => {
    expect(clean("Rotary Club de São Paulo")).toBe("Rotary Club de São Paulo");
    expect(clean("Rotary Club of Zürich")).toBe("Rotary Club of Zürich");
    expect(clean("東京ロータリークラブ")).toBe("東京ロータリークラブ");
  });

  it("removes digits, punctuation and emoji as before", () => {
    expect(clean("Club 1, Paris 🚀")).toBe("Club  Paris ");
  });
});

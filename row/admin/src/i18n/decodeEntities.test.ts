import { describe, expect, it } from "vitest";
import { decodeEntities } from "./decodeEntities";

describe("decodeEntities", () => {
  it("decodes the numeric and named entities MT providers return", () => {
    expect(decodeEntities("English&#10;")).toBe("English");
    expect(decodeEntities("l&#39;adresse &amp; le &quot;nom&quot; &lt;b&gt;")).toBe("l'adresse & le \"nom\" <b>");
    expect(decodeEntities("caf&#xE9;")).toBe("café");
  });
  it("leaves plain text alone", () => {
    expect(decodeEntities("Connexion")).toBe("Connexion");
  });
});

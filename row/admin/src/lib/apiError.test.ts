import { describe, expect, it } from "vitest";
import { ensureErrorMessage } from "./apiError";

// What the pages do with an error, in one line: it must always end up as text.
const shown = (data: unknown) => {
  const err = { response: { data } };
  ensureErrorMessage(err);
  const d = err.response.data as { message?: unknown } | null | undefined;
  return d?.message || d || "fallback";
};

describe("ensureErrorMessage", () => {
  it("uses the first validation error of an ASP.NET problem", () => {
    expect(shown({ type: "t", title: "One or more validation errors occurred.", status: 400, errors: { AmountType: ["The value '' is invalid."] }, traceId: "x" }))
      .toBe("The value '' is invalid.");
  });

  it("uses the title when a problem has no field errors", () => {
    expect(shown({ type: "t", title: "Not Found", status: 404 })).toBe("Not Found");
  });

  it("uses a plain sentence for any other object", () => {
    expect(shown({ code: "X" })).toBe("Something went wrong. Please try again.");
    expect(shown({ message: "" })).toBe("Something went wrong. Please try again.");
    expect(shown({ message: { nested: true } })).toBe("Something went wrong. Please try again.");
  });

  it("leaves the server's own message alone", () => {
    expect(shown({ message: "This payment link is out of date.", code: "Y" })).toBe("This payment link is out of date.");
  });

  it("leaves text bodies alone", () => {
    expect(shown("Bad gateway")).toBe("Bad gateway");
    expect(shown(null)).toBe("fallback");
    expect(shown(undefined)).toBe("fallback");
  });

  it("does not touch a file download or crash on odd errors", () => {
    const blob = new Blob(["x"]);
    const err = { response: { data: blob } };
    ensureErrorMessage(err);
    expect(err.response.data).toBe(blob);
    expect((blob as unknown as { message?: string }).message).toBeUndefined();
    expect(() => ensureErrorMessage(null)).not.toThrow();
    expect(() => ensureErrorMessage(new Error("network"))).not.toThrow();
  });
});

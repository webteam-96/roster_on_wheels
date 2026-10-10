import { hashProxyPassword, verifyProxyPassword } from "./admin-proxy-auth";

describe("admin proxy password", () => {
  it("verifies its own hashes and rejects wrong passwords", () => {
    const h = hashProxyPassword("s3cret!");
    expect(h).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(verifyProxyPassword("s3cret!", h)).toBe(true);
    expect(verifyProxyPassword("wrong", h)).toBe(false);
    expect(verifyProxyPassword("x", "garbage")).toBe(false);
  });
});

describe("admin proxy token", () => {
  it("round-trips and rejects tampering", () => {
    const { AdminProxyTokenSigner } = jest.requireActual("./admin-proxy-auth");
    const s = new AdminProxyTokenSigner("k".repeat(40));
    const t = s.issue("hash", "555", "first", 60);
    expect(s.validate(t)).toMatchObject({ urlHash: "hash", mobile: "555", slot: "first" });
    expect(s.validate(t.replace(/.$/, (c: string) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(new AdminProxyTokenSigner("other-key").validate(t)).toBeNull();
    expect(s.validate(s.issue("h", "m", "s", -5))).toBeNull();
  });
});

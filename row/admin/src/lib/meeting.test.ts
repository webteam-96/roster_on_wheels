import { describe, expect, it } from "vitest";
import { meetingPayload, validateMeeting } from "./meeting";

describe("meeting mode and link (same rule as the API)", () => {
  it("accepts in person without a link and online/hybrid with an https link", () => {
    expect(validateMeeting("in_person", "")).toBeNull();
    expect(validateMeeting("hybrid", "https://zoom.us/j/1")).toBeNull();
    expect(validateMeeting("online", "")).toBeNull();
  });

  it("refuses links that are not https", () => {
    expect(validateMeeting("online", "javascript:alert(1)")).toMatch(/https/);
    expect(validateMeeting("hybrid", "http://example.org")).toMatch(/https/);
  });

  it("drops the link for in-person meetings", () => {
    expect(meetingPayload("in_person", "https://zoom.us/j/1")).toEqual({ meetingMode: "in_person", meetingLink: null });
    expect(meetingPayload("online", " https://meet.google.com/abc ")).toEqual({ meetingMode: "online", meetingLink: "https://meet.google.com/abc" });
  });
});

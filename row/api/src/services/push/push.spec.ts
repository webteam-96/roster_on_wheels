import { messagingErrorCode } from "./firebase-push.service";
import { trimText, sourceTitle } from "./push-dispatcher";
import { announcementBody } from "./push-workers.service";

describe("push helpers", () => {
  it("maps FCM v1 error codes to the Admin SDK names", () => {
    expect(messagingErrorCode("UNREGISTERED")).toBe("Unregistered");
    expect(messagingErrorCode("INVALID_ARGUMENT")).toBe("InvalidArgument");
    expect(messagingErrorCode("SENDER_ID_MISMATCH")).toBe("SenderIdMismatch");
  });
  it("builds titles and bodies", () => {
    expect(sourceTitle("Announcement", "District 9990")).toBe("New Announcement · District 9990");
    expect(trimText("abcdef", 3)).toBe("abc…");
    expect(announcementBody("Hi", "")).toBe("Hi");
    expect(announcementBody("Hi", "x".repeat(170))).toBe(`Hi — ${"x".repeat(160)}…`);
  });
});

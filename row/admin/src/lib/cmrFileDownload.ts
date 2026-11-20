// The NEW CMR files from anywhere (user 2026-11-13): the Design B PDF or the new Word of one club's month,
// exactly the same file as the club's own CMR (list / preview / email). The new CMR preview is opened in a
// hidden frame (?embed=1&download=1 | word=1); it makes the file from the SAVED report, downloads it and tells
// us when it is done. Resolves when the file is saved, rejects on an error or after 5 minutes.
// Used by the District "Club Monthly Report" page and the old club CMR list; one file at a time.

export type CmrFileKind = "pdf" | "word";

export function downloadCmrFile(clubId: number, yearId: number, month: number, kind: CmrFileKind): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "CMR file";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // Off-screen, not display:none - the report must be laid out to be drawn.
    Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "1100px", height: "1400px", border: "0" });
    frame.src = `/clubs/${clubId}/club-monthly-report/v3/${yearId}/${month}/preview?embed=1&${kind === "word" ? "word" : "download"}=1`;

    const done = (err?: string) => {
      window.removeEventListener("message", onMsg);
      clearTimeout(giveUp);
      // Let the browser finish handing the file over before the frame goes.
      setTimeout(() => frame.remove(), 1500);
      if (err) reject(new Error(err)); else resolve();
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.contentWindow || e.data?.type !== "cmr-pdf") return;
      done(e.data.ok ? undefined : (e.data.message || "The report could not be made. Please try again."));
    };
    const giveUp = setTimeout(() => done("The download is taking too long. Please try again."), 300000);
    window.addEventListener("message", onMsg);
    document.body.appendChild(frame);
  });
}

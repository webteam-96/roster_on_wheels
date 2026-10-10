/**
 * Port of OcvLiveVisibility.cs: "live right now" predicates for the date-gated modules (published,
 * not expired; a NULL expiry never expires). The stored Status column is ignored, as everywhere else.
 */
export const OcvLiveVisibility = {
  upcomingEvents: (a: string) => `(${a}.PublishDate <= NOW() AND (${a}.ExpiryDate IS NULL OR ${a}.ExpiryDate >= NOW()))`,
  /** Legacy rows stored expiry equal to publish; those stay live. */
  newsletters: (a: string) => `(${a}.PublishDateTime <= NOW() AND (${a}.ExpiryDateTime IS NULL OR ${a}.ExpiryDateTime <= ${a}.PublishDateTime OR ${a}.ExpiryDateTime >= NOW()))`,
  clubDocuments: (a: string) => `(${a}.PublishDateTime <= NOW() AND (${a}.ExpiryDateTime IS NULL OR ${a}.ExpiryDateTime >= NOW()))`,
};

import type { ReactNode } from "react";

/**
 * Ground-truth leader profiles from example.org/OurLeaders.aspx.
 * Names, designations, biographies and button links are verbatim from the live
 * page (including original spellings/casing). Biodata PDFs and the one video
 * that is a hosted MP4 link absolutely to example.org; portraits are local.
 */
export type LeaderProfileData = {
  /** Editorial index numeral (design chrome). */
  index: string;
  name: string;
  /** Nickname line rendered under the name (e.g. "(Venky)"). */
  nick?: string;
  /** Designation lines, verbatim. */
  roles: string[];
  /** Zone parenthetical, verbatim (rendered as a chip). */
  zone?: string;
  photo: string;
  /** "Biodata" PDF (some leaders have none yet). */
  biodata?: string;
  /** "Video Introduction" link (two leaders have Biodata only). */
  video?: string;
  /** Full verbatim biography paragraphs. */
  bio: ReactNode;
};

export const CURRENT_LEADERS: LeaderProfileData[] = [];

export const PAST_PRESIDENTS: LeaderProfileData[] = [];

"use server";

import { sendHelpFeedback } from "@/lib/help";

/** "Was this helpful?" from the article page; the API validates the slug and rate-limits. */
export async function rateArticle(slug: string, helpful: boolean): Promise<boolean> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return false;
  try {
    return await sendHelpFeedback(slug, helpful === true);
  } catch {
    return false;
  }
}

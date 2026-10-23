// Engagement (build list #26-#28). The rule matches EngagementService.ParseYears in the API, which checks it again.
import type { SpotlightStatus } from "@/services/api";

/**
 * Milestone years typed as "1, 3, 5, 10": whole numbers from 1 to 100, at most 10 of them, returned sorted without
 * repeats. An empty text is an empty list (no milestone messages); null when an entry is not valid.
 */
export function parseMilestoneYears(text: string): number[] | null {
  const years: number[] = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    if (!/^\d+$/.test(part)) return null;
    const y = Number(part);
    if (y < 1 || y > 100) return null;
    if (!years.includes(y)) years.push(y);
  }
  return years.length > 10 ? null : years.sort((a, b) => a - b);
}

export const CARD_STATUS_LABELS: Record<SpotlightStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
};

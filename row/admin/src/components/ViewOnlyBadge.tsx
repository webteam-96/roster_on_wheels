"use client";

/**
 * Says why the Add / Edit / Delete controls are not on this page.
 *
 * Without it the page just looks broken to someone who had those buttons
 * yesterday — the year selector is the only thing that changed, and nothing
 * connects the two.
 *
 * ── The wording is NOT in this file ─────────────────────────────────────────
 * SuperAdmin writes it on Settings → Year-wise Admin Rights, the server sends it
 * with every /api/auth/my-context, and `lib/yearRuleMessages` fills in the
 * tokens. Mobile's `view_only_notice.dart` renders the SAME templates, so the
 * two can no longer drift the way they had before.
 *
 * The props are unchanged, so all 73 screens that use this badge keep passing
 * exactly what they passed before.
 */

import { useEffect, useState } from "react";
import { Eye } from "@/components/icons";
import {
  DEFAULT_YEAR_RULE_MESSAGES,
  getYearRuleMessages,
  renderYearRuleMessage,
  type YearRuleMessages,
} from "@/lib/yearRuleMessages";

interface Props {
  /** The year being viewed, e.g. "2024-25". Fills `{year}`. */
  yearLabel?: string;
  /** The years this member CAN edit here. Empty picks the shorter message. */
  editableYears?: string[];
  /**
   * For data that is NOT filed by Rotary year — announcements, upcoming events,
   * documents, greetings, mass email, web links. There is one live list, so only
   * an admin for the CURRENT year may ever change it.
   *
   * ⚠️ These screens must not use the ordinary wording. "You can make changes in
   * 2025-26" is untrue here: a 2025-26 admin cannot edit this data in any year,
   * because the rule asks for the current year and nothing else. Pass the current
   * year's label and the badge says the one thing that is actually true.
   */
  currentYearOnly?: string;
  /**
   * Overrides the list of actions named in the `currentYearOnly` wording, for a
   * screen whose blocked action is not "add, edit or delete" — the district
   * Directory's Remove Admin, for instance. Written to follow "can", and ending
   * the sentence itself, e.g. "remove an admin, add, edit or delete".
   *
   * Left out, the badge uses the SuperAdmin's `{actions}` default.
   */
  currentYearOnlyActions?: string;
  className?: string;
}

export default function ViewOnlyBadge({
  yearLabel, editableYears = [], currentYearOnly, currentYearOnlyActions,
  className = "",
}: Props) {
  // Starts on the defaults and loads the SuperAdmin's wording in an effect, NOT
  // during render: localStorage does not exist on the server, and reading it while
  // rendering would make the server's HTML and the browser's first paint disagree
  // (a hydration error on every page carrying this badge). The defaults are the
  // same sentence the server seeds, so the swap is invisible unless it was edited.
  const [messages, setMessages] = useState<YearRuleMessages>(DEFAULT_YEAR_RULE_MESSAGES);
  useEffect(() => { setMessages(getYearRuleMessages()); }, []);

  const years = editableYears.filter((y) => y?.trim());

  // Three cases, in the order the rule itself works:
  //   1. no year of its own      → current-year rights, and nothing else will do
  //   2. wrong year, holds others → name them, so there is somewhere to go
  //   3. wrong year, holds none   → say so plainly and stop
  const text =
    currentYearOnly !== undefined
      ? renderYearRuleMessage(
          messages.currentYearOnly,
          { currentYear: currentYearOnly, actions: currentYearOnlyActions },
          messages,
        )
      : years.length > 0
      ? renderYearRuleMessage(
          messages.wrongYearWithYears, { year: yearLabel, years }, messages,
        )
      : renderYearRuleMessage(
          messages.wrongYearNoYears, { year: yearLabel }, messages,
        );

  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 ${className}`}
      role="status"
    >
      <Eye className="mt-0.5 h-4 w-4 shrink-0" />
      {/*
        One plain string now, where this used to be assembled from JSX fragments.
        It has to be: a SuperAdmin can move the year anywhere in the sentence or
        drop it, so there is no fixed position left to hang a <span> on. "View
        only" is part of the template, which is why it is no longer bolded
        separately, bolding a slice of someone else's sentence would mean
        guessing where their words end.
      */}
      <span>{text}</span>
    </div>
  );
}

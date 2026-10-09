"use client";

import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";

/**
 * Global paste-truncation guard.
 *
 * PROBLEM: a field with `maxLength={N}` (event/announcement title, description, venue, …) is
 * truncated by the browser SILENTLY when the admin PASTES more than N characters. Typing is fine
 * (it just stops at N, visibly), but on paste the admin sees no signal — they believe all 700
 * pasted characters were saved when only the first 450 were, and the cut text then shows up half
 * in WhatsApp/email. This mounts ONCE (in the root layout) and listens for paste on the document
 * in the CAPTURE phase — i.e. BEFORE the browser inserts + truncates the text. If the paste would
 * overflow the target field's maxLength, it shows a toast telling the admin the text was shortened.
 *
 * Covers every <input>/<textarea> with a maxLength across the whole app (upcoming events,
 * announcements, newsletters, documents, projects, banners …) with no per-form change, so a new
 * limited field is protected automatically. It never blocks or alters the paste — informational only.
 */
export default function PasteLimitGuard() {
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return;
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;

      // maxLength is -1 when no limit is set on the field.
      const max = el.maxLength;
      if (max == null || max < 0) return;

      const pasted = e.clipboardData?.getData("text") ?? "";
      if (!pasted) return;

      // Resulting length = current value minus the selection the paste replaces, plus the paste.
      const selStart = el.selectionStart ?? el.value.length;
      const selEnd = el.selectionEnd ?? el.value.length;
      const selLen = Math.max(0, selEnd - selStart);
      const projected = el.value.length - selLen + pasted.length;

      if (projected > max) {
        const cut = projected - max;
        toast({
          variant: "destructive",
          title: `Text shortened to ${max} characters`,
          description:
            `You pasted ${cut} character(s) more than this field allows. Only the first ${max} ` +
            `were kept — please review, as the rest will NOT be saved or sent.`,
        });
      }
    }

    document.addEventListener("paste", onPaste, true); // capture: runs before the browser truncates
    return () => document.removeEventListener("paste", onPaste, true);
  }, []);

  return null;
}

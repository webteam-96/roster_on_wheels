"use client";

import { useEffect } from "react";
import { useLocaleControl } from "@/i18n/IntlProvider";
import { isMachineTranslated } from "@/i18n/config";
import { postTranslate } from "@/i18n/postTranslate";

/**
 * Runtime UI translator for ANY world language.
 *
 * The admin is almost entirely hardcoded English (only a handful of pages use
 * next-intl), so swapping message catalogs translates almost nothing. This walks
 * the live DOM text instead — like the Google-Translate widget — so the whole UI
 * is translated regardless of whether a page was internationalised.
 *
 * - Static locales (en + the hand-translated ones) and the dev pseudo-locale are
 *   left to next-intl; this does nothing for them.
 * - Text is batched to /api/i18n/translate (the pluggable MT provider) and cached
 *   in localStorage per locale, so each phrase is translated once, ever.
 * - A MutationObserver re-applies after client navigation / React re-renders.
 * - Placeholders are translated too; numbers, code, inputs and [data-no-translate]
 *   are skipped. Fails safe: on any error the text stays English.
 */

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "KBD", "SAMP", "TEXTAREA", "INPUT"]);
const HAS_LETTER = /\p{L}/u;

function translatableText(s: string | null): boolean {
  return !!s && s.trim().length > 1 && HAS_LETTER.test(s);
}

function nodeEligible(node: Text): boolean {
  const p = node.parentElement;
  if (!p) return false;
  if (SKIP_TAGS.has(p.tagName)) return false;
  if (p.closest('[data-no-translate],[contenteditable="true"],.font-mono')) return false;
  return true;
}

export default function LiveTranslate() {
  const { locale } = useLocaleControl();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isMachineTranslated(locale)) return; // English / pseudo: message files cover it

    let cancelled = false;
    const cacheKey = `i18n:dom:v2:${locale}`; // v2: v1 entries may hold undecoded HTML entities
    const cache: Record<string, string> = (() => {
      try { return JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch { return {}; }
    })();
    const touched = new Map<Text, string>();        // node -> English original (for restore)
    const placeholders = new Map<HTMLElement, string>(); // el -> English placeholder

    const persist = () => { try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch { /* quota */ } };

    async function translate(texts: string[]): Promise<void> {
      const miss = Array.from(new Set(texts.filter((t) => cache[t] === undefined)));
      for (let i = 0; i < miss.length; i += 300) {
        if (cancelled) return;
        const chunk = miss.slice(i, i + 300);
        try {
          const res = await postTranslate({ target: locale, source: "en", q: chunk });
          if (!res.ok) continue;
          const { translations } = (await res.json()) as { translations: string[] };
          chunk.forEach((orig, j) => { cache[orig] = translations?.[j] || orig; });
        } catch { chunk.forEach((orig) => { cache[orig] = orig; }); }
      }
      persist();
    }

    let observer: MutationObserver | null = null;

    async function pass(): Promise<void> {
      if (cancelled) return;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const need: string[] = [];
      const seen: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const node = n as Text;
        const prevOrig = touched.get(node);
        if (prevOrig !== undefined) {
          // Already handled once; React may have reset it to English — re-apply.
          const tr = cache[prevOrig];
          if (tr && node.nodeValue !== tr) node.nodeValue = tr;
          continue;
        }
        if (!nodeEligible(node) || !translatableText(node.nodeValue)) continue;
        const orig = node.nodeValue as string;
        touched.set(node, orig);
        seen.push(node);
        if (cache[orig] === undefined) need.push(orig);
      }
      // Placeholders (visible hint text on inputs/textareas).
      document.querySelectorAll<HTMLElement>("input[placeholder],textarea[placeholder]").forEach((el) => {
        if (placeholders.has(el)) {
          const tr = cache[placeholders.get(el)!];
          if (tr) el.setAttribute("placeholder", tr);
          return;
        }
        const ph = el.getAttribute("placeholder");
        if (!translatableText(ph)) return;
        placeholders.set(el, ph as string);
        if (cache[ph as string] === undefined) need.push(ph as string);
      });

      if (need.length) {
        if (observer) observer.disconnect();
        await translate(need);
        if (cancelled) return;
      }
      // Apply (synchronously), with the observer paused so our own writes don't loop.
      if (observer) observer.disconnect();
      for (const node of seen) {
        const orig = touched.get(node);
        if (orig && cache[orig] && node.isConnected) node.nodeValue = cache[orig];
      }
      placeholders.forEach((orig, el) => { if (cache[orig] && el.isConnected) el.setAttribute("placeholder", cache[orig]); });
      if (observer && !cancelled) observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    }

    // Debounced observer so bursts of React updates coalesce into one pass.
    let timer: ReturnType<typeof setTimeout> | null = null;
    observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void pass(); }, 250);
    });

    void pass();
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      // Restore English so switching back (or to another language) starts clean.
      touched.forEach((orig, node) => { if (node.isConnected) node.nodeValue = orig; });
      placeholders.forEach((orig, el) => { if (el.isConnected) el.setAttribute("placeholder", orig); });
    };
  }, [locale]);

  return null;
}

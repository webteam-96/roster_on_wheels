"use client";

/**
 * ClassificationAssist — the shared classification helper for the project Classification section,
 * reused across every service-avenue Add/Edit page.
 *
 * Gate model (per product ask): the classification is LOCKED until the user clicks
 * "Auto-Suggest Category". While locked, the smart search here is greyed/disabled and the
 * parent greys its own Area/Category/Sub dropdowns (driven by the `unlocked` prop it controls).
 * Pressing the button (a) unlocks everything and (b) fires the ONE AI request — the AI never runs
 * on its own. After unlocking, the user can pick an AI suggestion, use the smart search, or the
 * dropdowns; the button stays available as a small "re-suggest" action.
 *
 * The parent keeps its own dropdowns; this component only drives them via onApply. `unlocked`
 * defaults to true so any page that doesn't wire the gate simply stays usable (button still works).
 * Colours are hard-coded violet (Tailwind can't see runtime-built class names).
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sparkles, Loader2, Check, ArrowRightLeft, Lock } from "@/components/icons";
import {
  searchProjectClassifications,
  suggestProjectClassification,
  type ClassificationSearchResult,
} from "@/services/api";
import { isRoutableModule, stashProjectSwitchDraft } from "@/lib/projectDraft";

type AiStatus = "idle" | "loading" | "error" | "done";

const MIN_DESC = 15; // need at least this much description before an AI call is worth making

interface ClassificationAssistProps {
  clubId: number;
  moduleId: number | null;
  moduleKey: string;
  title: string;
  description: string;
  // Apply a chosen classification (search pick or AI in-module suggestion) to the parent's dropdowns.
  onApply: (r: ClassificationSearchResult) => void;
  // Currently-selected sub-category id (string) so a suggestion can show its "Selected" state.
  selectedSubCatId?: string;
  // Cross-module "better fit" switch. Off on Edit pages (can't migrate an existing project record).
  enableCrossModule?: boolean;
  // Builds the "carry everything possible" draft handed to the target page on switch.
  buildSwitchDraft?: () => Record<string, unknown>;
  // The gate: while false, the smart search here is disabled and the parent greys its dropdowns.
  // Pressing "Auto-Suggest Category" calls onUnlock() to flip it. Defaults to true (no gate).
  unlocked?: boolean;
  onUnlock?: () => void;
}

export default function ClassificationAssist({
  clubId, moduleId, moduleKey, title, description, onApply, selectedSubCatId,
  enableCrossModule = true, buildSwitchDraft, unlocked = true, onUnlock,
}: ClassificationAssistProps) {
  const router = useRouter();
  void moduleKey; // reserved for future per-module tuning; kept for a stable call signature

  // Smart search (module-scoped).
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClassificationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  // AI suggestion — fired ONLY by the button, never automatically.
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [matches, setMatches] = useState<ClassificationSearchResult[]>([]);
  const [better, setBetter] = useState<ClassificationSearchResult | null>(null);
  const [needText, setNeedText] = useState(false); // pressed with too little text to suggest
  const aiLastRef = useRef<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced smart search (only meaningful once unlocked; input is disabled while locked).
  const onQueryChange = (v: string) => {
    setQuery(v); setOpen(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = v.trim();
    if (!moduleId || term.length < 1) { setResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try { setResults(await searchProjectClassifications(term, moduleId)); }
      catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
  };

  // Fire the AI once (deduped on the exact title+description). Called only from the button.
  const runSuggest = async () => {
    if (!moduleId) return;
    const t = title.trim(), d = description.trim();
    if (!t || d.length < MIN_DESC) { setNeedText(true); return; } // unlock happened; just no call
    setNeedText(false);
    const key = `${t}\n${d}`;
    if (key === aiLastRef.current && aiStatus === "done") return; // already suggested this exact text
    aiLastRef.current = key;
    setAiStatus("loading");
    try {
      const res = await suggestProjectClassification(t, d, moduleId);
      setMatches(res.matches ?? []);
      setBetter(res.betterModule ?? null);
      setAiStatus("done");
    } catch {
      setMatches([]); setBetter(null);
      setAiStatus("error");
    }
  };

  // The button: unlock the section (once) + fire the AI request.
  const handleAutoSuggest = () => {
    if (!unlocked) onUnlock?.();
    runSuggest();
  };

  const applyPick = (r: ClassificationSearchResult) => {
    onApply(r);
    setQuery(""); setResults([]); setOpen(false);
  };

  const showBetter = enableCrossModule && !!better && isRoutableModule(better.moduleKey)
    && !!better.areaOfFocusId;

  const handleSwitch = () => {
    if (!better || !better.moduleKey) return;
    const fields = buildSwitchDraft ? buildSwitchDraft() : {};
    const path = stashProjectSwitchDraft(clubId, better.moduleKey, fields, {
      areaOfFocusId: better.areaOfFocusId,
      categoryId: better.categoryId ?? null,
      subCategoryId: better.subCategoryId ?? null,
    }, Date.now());
    if (path) router.push(path);
  };

  const pathLabel = (r: ClassificationSearchResult) => (
    <>
      {r.areaOfFocusName}
      {r.categoryName && <> <span className="text-slate-400">›</span> {r.categoryName}</>}
      {r.subCategoryName && <> <span className="text-slate-400">›</span> <span className="font-medium text-slate-800">{r.subCategoryName}</span></>}
    </>
  );

  const loading = aiStatus === "loading";

  return (
    <div className="mb-4">
      {/* Auto-Suggest Category button — the gate. Prominent while locked; compact once unlocked. */}
      {!unlocked ? (
        <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50/60 p-4 text-center">
          <button
            type="button"
            onClick={handleAutoSuggest}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Auto-Suggest Category
          </button>
          <p className="mt-2 flex items-center justify-center gap-1 text-xs text-slate-500">
            <Lock className="h-3 w-3" />
            Click to get AI suggestions and unlock the search &amp; dropdowns below.
          </p>
          {needText && (
            <p className="mt-1 text-xs text-amber-600">Add a title and a longer description first for AI suggestions: the fields below are now unlocked.</p>
          )}
        </div>
      ) : (
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleAutoSuggest}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Auto-Suggest Category
          </button>
          {aiStatus === "error" && <span className="text-xs text-rose-600">AI unavailable. Use the search or dropdowns.</span>}
          {needText && <span className="text-xs text-amber-600">Add a longer description for AI suggestions.</span>}
        </div>
      )}

      {/* Smart search — disabled/greyed until the section is unlocked. */}
      <div className={`relative ${unlocked ? "" : "opacity-50 pointer-events-none select-none"}`} aria-disabled={!unlocked}>
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={query}
          disabled={!unlocked}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={unlocked ? "Type to search all three levels…" : "Locked. Use Auto-Suggest above first"}
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-slate-50"
        />
        {unlocked && open && query.trim().length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-72 overflow-auto">
            {searching ? (
              <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No matches.</div>
            ) : results.map((r, i) => (
              <button
                key={`${r.type}-${r.areaOfFocusId}-${r.categoryId ?? 0}-${r.subCategoryId ?? 0}-${i}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyPick(r)}
                className="w-full text-left px-3 py-2 hover:bg-violet-50 flex items-center gap-2"
              >
                <span className="shrink-0 text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                  {r.type === "area" ? "Area" : r.type === "category" ? "Category" : "Sub"}
                </span>
                <span className="text-sm text-slate-700">{pathLabel(r)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI in-module suggestions — user Selects; never auto-applied. */}
      {matches.length > 0 && (
        <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/60 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 mb-1.5">
            <Sparkles className="h-3.5 w-3.5" /> AI suggestion{matches.length > 1 ? "s" : ""}: review &amp; select
          </div>
          <div className="space-y-1.5">
            {matches.map((r, i) => {
              // Compare on the deepest id the result carries so the badge also works on 2-level
              // modules (leaf = category, subCategoryId null), whose parent passes its category id here.
              const leafId = String(r.subCategoryId ?? r.categoryId ?? r.areaOfFocusId ?? "");
              const selected = !!selectedSubCatId && selectedSubCatId === leafId;
              return (
                <div key={`ai-${r.subCategoryId ?? 0}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5">
                  <span className="text-xs text-slate-700">{pathLabel(r)}</span>
                  <button
                    type="button"
                    onClick={() => applyPick(r)}
                    className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${selected ? "bg-emerald-100 text-emerald-700" : "bg-violet-600 text-white hover:bg-violet-700"}`}
                  >
                    {selected ? <><Check className="h-3 w-3" /> Selected</> : "Select"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Passive "better fit" hint — a different project type suits this project better. */}
      {showBetter && better && (
        <button
          type="button"
          onClick={handleSwitch}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-800 hover:underline"
          title={`Move this project to ${better.moduleName}`}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          <span>
            Better fit: <span className="font-semibold">{better.moduleName}</span>
            {(better.categoryName || better.areaOfFocusName) && <> <span className="text-amber-400">›</span> {better.categoryName || better.areaOfFocusName}</>}
            <span className="text-amber-500">: switch &amp; carry over</span>
          </span>
        </button>
      )}
    </div>
  );
}

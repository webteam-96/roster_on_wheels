import type { QuestionType, SaveSurvey, Survey, SurveyState } from "@/types/surveys";

// Helpers for the survey pages (api/Services/SurveyRules.cs holds the rules).

/** One editable question; options stay one per line while typed. */
export interface QuestionRow {
  text: string;
  type: QuestionType;
  required: boolean;
  options: string;
}

export interface SurveyForm {
  title: string;
  description: string;
  subGroupId: string;
  isAnonymous: boolean;
  showResults: boolean;
  opensAt: string;
  closesAt: string;
  questions: QuestionRow[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A date to the "YYYY-MM-DDTHH:mm" a datetime-local input wants, in the viewer's own zone. */
export const localInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** A datetime-local value (viewer's zone) to UTC ISO for the API; "" stays "". */
export const toUtc = (local: string) => (local ? new Date(local).toISOString() : "");

export const isChoice = (t: QuestionType) => t === "single" || t === "multiple";

export const emptyQuestion = (): QuestionRow => ({ text: "", type: "single", required: true, options: "Yes\nNo" });

export const toForm = (s: Survey | null, now = new Date()): SurveyForm => ({
  title: s?.title ?? "",
  description: s?.description ?? "",
  subGroupId: s?.subGroupId ? String(s.subGroupId) : "",
  isAnonymous: s?.isAnonymous ?? false,
  showResults: s?.showResults ?? true,
  opensAt: localInput(s ? new Date(s.opensAt) : now),
  closesAt: localInput(s ? new Date(s.closesAt) : new Date(now.getTime() + 7 * 864e5)),
  questions: s?.questions?.map((q) => ({ text: q.text, type: q.type, required: q.required, options: q.options.join("\n") })) ?? [emptyQuestion()],
});

export const toBody = (f: SurveyForm): SaveSurvey => ({
  title: f.title.trim(),
  description: f.description.trim() || null,
  subGroupId: f.subGroupId ? Number(f.subGroupId) : null,
  isAnonymous: f.isAnonymous,
  showResults: f.showResults,
  opensAt: toUtc(f.opensAt),
  closesAt: toUtc(f.closesAt),
  questions: f.questions.map((q) => ({
    text: q.text.trim(),
    type: q.type,
    required: q.required,
    options: isChoice(q.type) ? q.options.split("\n").map((o) => o.trim()).filter(Boolean) : [],
  })),
});

export const STATE_LABEL: Record<SurveyState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
};

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: "One choice",
  multiple: "Several choices",
  rating: "Rating 1 to 5",
  text: "Written answer",
};

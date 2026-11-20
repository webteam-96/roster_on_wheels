// Surveys and polls (api/DTOs/SurveyDtos.cs). Times are UTC ISO strings ("...Z").

export type SurveyScope = "clubs" | "districts";
export type QuestionType = "single" | "multiple" | "text" | "rating";
export type SurveyState = "draft" | "scheduled" | "open" | "closed";

export interface SurveyQuestion {
  id: number;
  text: string;
  type: QuestionType;
  required: boolean;
  options: string[];
}

export interface Survey {
  id: number;
  clubId: number | null;
  districtId: number | null;
  subGroupId: number | null;
  subGroupName: string | null;
  title: string;
  description: string | null;
  isAnonymous: boolean;
  showResults: boolean;
  state: SurveyState;
  opensAt: string;
  closesAt: string;
  responseCount: number;
  audienceCount: number | null;
  questions: SurveyQuestion[] | null;
}

export interface SaveSurvey {
  title: string;
  description: string | null;
  subGroupId: number | null;
  isAnonymous: boolean;
  showResults: boolean;
  opensAt: string;
  closesAt: string;
  questions: { text: string; type: QuestionType; required: boolean; options: string[] }[];
}

export interface SurveyQuestionResult {
  questionId: number;
  text: string;
  type: QuestionType;
  answered: number;
  options: { label: string; count: number; percent: number }[];
  ratingAverage: number | null;
  textAnswers: { text: string; name: string | null }[];
}

export interface SurveyResults {
  surveyId: number;
  title: string;
  isAnonymous: boolean;
  responseCount: number;
  audienceCount: number;
  responseRate: number;
  questions: SurveyQuestionResult[];
}

export interface SurveySubGroup {
  id: number;
  name: string;
}

"use client";

// Club Admin Dashboard > Surveys and polls (components/surveys/SurveysList.tsx).

import SurveysList from "@/components/surveys/SurveysList";
import { useAuth } from "@/contexts/AuthContext";

export default function SurveysPage() {
  const { selectedClubId } = useAuth();
  return <SurveysList scope="clubs" scopeId={selectedClubId} basePath="/club-admin-dashboard/surveys" />;
}

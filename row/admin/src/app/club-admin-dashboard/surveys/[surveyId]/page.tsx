"use client";

// Club Admin Dashboard > Surveys and polls > one survey ("new" starts one).

import { useParams } from "next/navigation";
import SurveyEditor from "@/components/surveys/SurveyEditor";
import { useAuth } from "@/contexts/AuthContext";

export default function SurveyPage() {
  const { selectedClubId } = useAuth();
  const param = String(useParams().surveyId);
  return <SurveyEditor key={param} scope="clubs" scopeId={selectedClubId} param={param} basePath="/club-admin-dashboard/surveys" />;
}

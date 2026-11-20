"use client";

// District Admin Dashboard > Surveys and polls > one survey ("new" starts one).

import { useParams } from "next/navigation";
import SurveyEditor from "@/components/surveys/SurveyEditor";
import { useAuth } from "@/contexts/AuthContext";

export default function SurveyPage() {
  const { selectedDistrictId } = useAuth();
  const param = String(useParams().surveyId);
  return <SurveyEditor key={param} scope="districts" scopeId={selectedDistrictId} param={param} basePath="/district-admin-dashboard/surveys" />;
}

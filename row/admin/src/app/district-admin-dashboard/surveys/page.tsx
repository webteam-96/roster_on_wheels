"use client";

// District Admin Dashboard > Surveys and polls (components/surveys/SurveysList.tsx).

import SurveysList from "@/components/surveys/SurveysList";
import { useAuth } from "@/contexts/AuthContext";

export default function SurveysPage() {
  const { selectedDistrictId } = useAuth();
  return <SurveysList scope="districts" scopeId={selectedDistrictId} basePath="/district-admin-dashboard/surveys" />;
}

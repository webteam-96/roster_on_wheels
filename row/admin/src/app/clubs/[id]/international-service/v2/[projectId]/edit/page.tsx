"use client";

/**
 * International Service v2 — Edit Project. yearId comes from ?yearId= (the API requires it).
 * The form, its state and its API calls live in ../_project-form (shared with the other one-time
 * service avenues); this module's differences are in its config entry there.
 */

import ServiceProjectForm from "@/app/clubs/[id]/_project-form/ServiceProjectForm";
import { INTERNATIONAL_SERVICE } from "@/app/clubs/[id]/_project-form/config";
import { useServiceProjectEdit } from "@/app/clubs/[id]/_project-form/useServiceProjectEdit";

export default function InternationalServiceV2EditPage() {
  const form = useServiceProjectEdit(INTERNATIONAL_SERVICE);
  return <ServiceProjectForm cfg={INTERNATIONAL_SERVICE} mode="edit" form={form} />;
}

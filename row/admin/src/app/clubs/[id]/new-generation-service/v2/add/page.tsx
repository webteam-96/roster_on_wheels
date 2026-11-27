"use client";

/**
 * New Generation Service v2 — Add Project. v2 reads ONLY `?returnTo=`.
 * The form, its state and its API calls live in ../_project-form (shared with the other one-time
 * service avenues); this module's differences are in its config entry there.
 */

import ServiceProjectForm from "@/app/clubs/[id]/_project-form/ServiceProjectForm";
import { NEW_GENERATION_SERVICE } from "@/app/clubs/[id]/_project-form/config";
import { useServiceProjectAdd } from "@/app/clubs/[id]/_project-form/useServiceProjectAdd";

export default function NewGenerationServiceV2AddPage() {
  const form = useServiceProjectAdd(NEW_GENERATION_SERVICE);
  return <ServiceProjectForm cfg={NEW_GENERATION_SERVICE} mode="add" form={form} />;
}

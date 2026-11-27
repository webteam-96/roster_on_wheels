"use client";

/**
 * Vocational Service v2 — Add Project. v2 reads ONLY `?returnTo=`.
 * The form, its state and its API calls live in ../_project-form (shared with the other one-time
 * service avenues); this module's differences are in its config entry there.
 */

import ServiceProjectForm from "@/app/clubs/[id]/_project-form/ServiceProjectForm";
import { VOCATIONAL_SERVICE } from "@/app/clubs/[id]/_project-form/config";
import { useServiceProjectAdd } from "@/app/clubs/[id]/_project-form/useServiceProjectAdd";

export default function VocationalServiceV2AddPage() {
  const form = useServiceProjectAdd(VOCATIONAL_SERVICE);
  return <ServiceProjectForm cfg={VOCATIONAL_SERVICE} mode="add" form={form} />;
}

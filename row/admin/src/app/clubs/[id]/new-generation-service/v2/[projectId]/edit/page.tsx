"use client";

/**
 * New Generation Service v2 — Edit Project. yearId from ?yearId=, else probed across the club's project years.
 * The form, its state and its API calls live in ../_project-form (shared with the other one-time
 * service avenues); this module's differences are in its config entry there.
 */

import ServiceProjectForm from "@/app/clubs/[id]/_project-form/ServiceProjectForm";
import { NEW_GENERATION_SERVICE } from "@/app/clubs/[id]/_project-form/config";
import { useServiceProjectEdit } from "@/app/clubs/[id]/_project-form/useServiceProjectEdit";

export default function NewGenerationServiceV2EditPage() {
  const form = useServiceProjectEdit(NEW_GENERATION_SERVICE);
  return <ServiceProjectForm cfg={NEW_GENERATION_SERVICE} mode="edit" form={form} />;
}

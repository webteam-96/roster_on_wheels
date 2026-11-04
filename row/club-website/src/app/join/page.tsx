import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThemedShell } from "@/site/SitePage";
import Breadcrumb from "@/themes/shared/Breadcrumb.jsx";
import { buildShell } from "@/lib/pageShell";
import { fetchJson } from "@/lib/api";
import { SiteNotFound } from "@/components/SiteNotFound";
import { StatusOverlay } from "@/components/StatusOverlay";
import { JoinForm } from "@/components/JoinForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join the club" };

// "Interested in joining" page. Club admins link it from the website menu as a URL menu item pointing to /join.
// The API answers 404 while the ROW feature is switched off, and then this page is a 404 too.
export default async function JoinPage() {
  const shell = await buildShell();
  if (!shell) return <SiteNotFound host="" />;

  const { tenant, about } = shell;
  if (tenant.status === "trial_expired" || tenant.status === "expired") {
    return <StatusOverlay tenant={tenant} />;
  }
  const club = await fetchJson<{ clubName: string }>(`/api/public/join/club/${tenant.clubId}`);
  if (!club) notFound();
  const clubName = about?.clubName || club.clubName;

  return (
    <ThemedShell shell={shell}>
      <StatusOverlay tenant={tenant} />
      <Breadcrumb eyebrow={clubName} title="Interested in joining?" crumbLabel="Join" />
      <section className="bg-canvas py-12">
        <div className="container-x">
          <article className="mx-auto max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 shadow-card sm:p-10">
            <p className="mb-6 text-[15px] leading-relaxed text-ink">
              Tell us a little about yourself and a member of the club will contact you, usually with an invitation to a meeting.
            </p>
            <JoinForm clubId={tenant.clubId} clubName={clubName} apiBase={process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"} />
          </article>
        </div>
      </section>
    </ThemedShell>
  );
}

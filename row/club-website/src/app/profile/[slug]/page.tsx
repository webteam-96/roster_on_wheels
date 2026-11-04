import Image from "next/image";
import { notFound } from "next/navigation";
import { ThemedShell } from "@/site/SitePage";
import Breadcrumb from "@/themes/shared/Breadcrumb.jsx";
import { buildShell } from "@/lib/pageShell";
import {
  getBoardOfDirectors, getInternationalPresident, getDistrictGovernor,
} from "@/lib/publicApi";
import { photoUrl } from "@/lib/imageUrl";
import { Avatar } from "@/components/Avatar";
import { SiteNotFound } from "@/components/SiteNotFound";
import { StatusOverlay } from "@/components/StatusOverlay";

export const dynamic = "force-dynamic";

// Detail / full profile page for the home-page cards.
// Slug values supported:
//   - "intl-president"     → International President (current year)
//   - "district-governor"  → District Governor (current year, club's district)
//   - "president"          → Club President (current year)
//   - "secretary"          → Club Secretary (current year)
//
// Home page cards link here with target="_blank" so admins/users can read the
// full bio (rendered as HTML) without leaving the home page.
interface PageProps { params: { slug: string } }

interface ProfileData {
  badge: string;
  name: string;
  designation: string;
  yearLabel: string | null;
  photoPath: string | null;
  descriptionHtml: string | null;
}

export default async function ProfilePage({ params }: PageProps) {
  const shell = await buildShell();
  if (!shell) return <SiteNotFound host="" />;

  const { tenant, about, currentYearId } = shell;
  if (tenant.status === "trial_expired" || tenant.status === "expired") {
    return <StatusOverlay tenant={tenant} />;
  }

  const data = await resolveProfile(params.slug, tenant.clubId, currentYearId, about?.districtNumber ?? null);
  if (!data) notFound();

  return (
    <ThemedShell shell={shell}>
      <StatusOverlay tenant={tenant} />
      <Breadcrumb eyebrow={data.badge} title={data.name} crumbLabel={data.name} />
      <section className="bg-canvas py-12">
        <div className="container-x">
          <article className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
            <div className="grid grid-cols-1 sm:grid-cols-3">
              <div className="relative aspect-square bg-navy/5 sm:col-span-1 sm:aspect-auto">
                {data.photoPath ? (
                  <Image
                    src={photoUrl(data.photoPath) ?? ""}
                    alt={data.name}
                    fill
                    sizes="(max-width:640px) 100vw, 33vw"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Avatar name={data.name} src={null} size={180} rounded="full" />
                  </div>
                )}
              </div>
              <div className="p-6 sm:col-span-2 sm:p-10">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold-cta">{data.badge}</p>
                <h2 className="mt-2 font-heading text-3xl font-extrabold leading-tight text-navy sm:text-4xl">{data.name}</h2>
                <p className="mt-1.5 text-sm text-muted">{data.designation}</p>
                {data.yearLabel && <p className="mt-0.5 text-xs text-muted">{data.yearLabel}</p>}
              </div>
            </div>
            {data.descriptionHtml && (
              <div className="border-t border-gray-100 p-6 sm:p-10">
                {/* Admin-edited content from authenticated admins, rendered as HTML (same as /m/[slug] pages). */}
                <div className="rich-text break-words text-[15px] leading-relaxed text-ink"
                  dangerouslySetInnerHTML={{ __html: data.descriptionHtml }} />
              </div>
            )}
          </article>
        </div>
      </section>
    </ThemedShell>
  );
}

async function resolveProfile(
  slug: string,
  clubId: number,
  currentYearId: number | null,
  districtNumber: string | null
): Promise<ProfileData | null> {
  const s = slug.toLowerCase();

  if (s === "intl-president" || s === "international-president") {
    const ip = await getInternationalPresident(clubId, currentYearId ?? undefined);
    if (!ip) return null;
    return {
      badge: "International President",
      name: ip.name,
      designation: ip.designation ?? "Rotary International",
      yearLabel: ip.yearLabel ?? null,
      photoPath: ip.profilePhotoPath ?? null,
      descriptionHtml: ip.description ?? null,
    };
  }

  if (s === "district-governor" || s === "dg") {
    const dg = await getDistrictGovernor(clubId, currentYearId ?? undefined);
    if (!dg) return null;
    return {
      badge: "District Governor",
      name: dg.memberName,
      designation: `District Governor${districtNumber ? ` · District ${districtNumber}` : ""}`,
      yearLabel: dg.yearLabel ?? null,
      photoPath: dg.profilePhoto ?? null,
      descriptionHtml: dg.description ?? null,
    };
  }

  if (s === "president" || s === "secretary") {
    const bod = (await getBoardOfDirectors(clubId, currentYearId ?? undefined)) ?? [];
    const member = s === "president"
      ? bod.find((d) => /president\s*$/i.test(d.designation) && !/past|elect|vice|asst|assistant/i.test(d.designation))
      : bod.find((d) => /secretary/i.test(d.designation) && !/asst|assistant/i.test(d.designation));
    if (!member) return null;
    return {
      badge: s === "president" ? "Club President" : "Club Secretary",
      name: member.memberName,
      designation: member.designation,
      yearLabel: null,
      photoPath: member.profilePhotoPath ?? null,
      descriptionHtml: member.memberIntroduction ?? null,
    };
  }

  return null;
}

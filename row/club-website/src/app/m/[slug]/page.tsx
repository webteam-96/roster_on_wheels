import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { ThemedShell } from "@/site/SitePage";
import Breadcrumb, { EmptyState } from "@/themes/shared/Breadcrumb.jsx";
import { buildShell } from "@/lib/pageShell";
import { siteText } from "@/lib/siteLanguage";
import { SiteNotFound } from "@/components/SiteNotFound";
import { StatusOverlay } from "@/components/StatusOverlay";
import type { Menu } from "@/lib/publicApi";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
}

// Resolves a custom menu by its slug. The admin saves either:
//   - linkType = "url" / "external"  → linkValue is an absolute URL → server-redirect
//   - linkType = "document"          → linkValue is an uploaded file path → redirect to API origin
//   - linkType = "html"              → contentHtml is rich HTML → render inside the theme
function findMenu(menus: Menu[] | null, slug: string): Menu | undefined {
  if (!menus) return undefined;
  const wanted = decodeURIComponent(slug).toLowerCase();
  // Slugs come from the default-language name (sourceName), so /m/our-team is the same page in every language.
  return menus.find((m) => !m.isDefault && (
    m.linkValue?.toLowerCase() === wanted ||
    slugifyName(m.sourceName ?? m.menuName) === wanted
  ));
}

function slugifyName(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const shell = await buildShell();
  const menu = findMenu(shell?.menus ?? null, params.slug);
  if (!shell || !menu) return {};
  const t = siteText(shell.lang, "page", menu.id);
  return { title: t?.seoTitle ? { absolute: t.seoTitle } : menu.menuName, description: t?.seoDescription || undefined };
}

export default async function CustomMenuPage({ params }: PageProps) {
  const shell = await buildShell();
  if (!shell) return <SiteNotFound host="" />;

  const { tenant, about, menus } = shell;
  if (tenant.status === "trial_expired" || tenant.status === "expired") {
    return <StatusOverlay tenant={tenant} />;
  }

  const menu = findMenu(menus, params.slug);
  if (!menu) notFound();

  // External / URL / document → server-side redirect so the browser bar updates correctly.
  if (menu.linkType === "url" || menu.linkType === "external") {
    if (menu.linkValue) redirect(menu.linkValue);
    notFound();
  }
  if (menu.linkType === "document") {
    if (menu.linkValue) {
      const docOrigin = process.env.NEXT_PUBLIC_API_URL || "";
      const target = /^https?:/i.test(menu.linkValue) ? menu.linkValue : `${docOrigin}${menu.linkValue}`;
      redirect(target);
    }
    notFound();
  }

  // Rich-text page — render the HTML safely inside the active theme's Layout.
  // dangerouslySetInnerHTML is acceptable here because the source is admin-edited
  // content stored server-side and only an authenticated admin can write it.
  return (
    <ThemedShell shell={shell}>
      <StatusOverlay tenant={tenant} />
      <Breadcrumb eyebrow={about?.clubName || tenant.clubName} title={menu.menuName} crumbLabel={menu.menuName} />
      <section className="bg-canvas py-12">
        <div className="container-x">
          <article className="rounded-2xl border border-gray-100 bg-white p-6 shadow-card sm:p-10">
            {menu.contentHtml ? (
              <div className="rich-text break-words text-[15px] leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: menu.contentHtml }} />
            ) : (
              <EmptyState title="Nothing here yet" message="This page has no content yet." />
            )}
          </article>
        </div>
      </section>
    </ThemedShell>
  );
}

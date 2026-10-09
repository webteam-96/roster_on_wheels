"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { PageBanner } from "@/components/site/PageBanner";
import { SiteFooter } from "@/components/site/SiteFooter";
import {
  EmptyState,
  FilterConsole,
  ProjectCard,
  SelectField,
  fmt,
  titleCase,
  type CardData,
} from "@/components/pages/projects/shared";

export type ExploreProject = {
  id: number;
  title: string;
  club: string;
  district: string;
  area: string;
  cost: number;
  beneficiaries: number;
  date: string | null;
  photo: string | null;
};

/**
 * The visual browse mode of the projects hub — same card language as
 * /projects, image-led wherever the field report carries a photo.
 */
export function ProjectsExplorer({ projects }: { projects: ExploreProject[] }) {
  const [area, setArea] = useState("");
  const [district, setDistrict] = useState("");
  const [query, setQuery] = useState("");

  const areas = useMemo(
    () => Array.from(new Set(projects.map((p) => p.area).filter(Boolean))).sort(),
    [projects]
  );
  const districts = useMemo(
    () => Array.from(new Set(projects.map((p) => p.district).filter(Boolean))).sort(),
    [projects]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter(
      (p) =>
        (!area || p.area === area) &&
        (!district || p.district === district) &&
        (!q || p.title.toLowerCase().includes(q) || p.club.toLowerCase().includes(q))
    );
  }, [projects, area, district, query]);

  const clearAll = () => {
    setArea("");
    setDistrict("");
    setQuery("");
  };

  const cards: CardData[] = filtered.map((p) => ({
    key: p.id,
    href: `/projects/${p.id}`,
    title: p.title,
    area: p.area || null,
    where: [p.club, p.district ? `RID ${p.district}` : ""].filter(Boolean).join(" · "),
    date: p.date,
    cost: p.cost || null,
    beneficiaries: p.beneficiaries || null,
    photo: p.photo,
  }));

  return (
    <>
      <PageBanner
        eyebrow="Live from the field"
        breadcrumb={
          <>
            Home <span className="mx-1.5 text-gold-deep">›</span>{" "}
            <Link href="/projects" className="transition-colors hover:text-gold-deep">
              Projects
            </Link>{" "}
            <span className="mx-1.5 text-gold-deep">›</span> Explore
          </>
        }
        subtitle="A visual selection of real Rotary projects, straight from live field reports — browse by cause, district, or search."
        rightSlot={
          <div className="lg:text-right">
            <p
              className="figure text-[clamp(3rem,4.5vw,4.25rem)] leading-none text-gold-deep"
              data-counter={projects.length}
            >
              {fmt(projects.length)}
            </p>
            <p className="microlabel mt-3">Projects in this live selection</p>
          </div>
        }
      >
        Explore <span className="text-gold">projects</span>
      </PageBanner>

      <section className="bg-paper pb-24 lg:pb-32">
        <div className="container-rotary">
          {/* Pulled-up filter console */}
          <FilterConsole>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
              <label className="block" htmlFor="explore-search">
                <span className="microlabel">Search</span>
                <div className="relative mt-2">
                  <Search
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/50"
                    aria-hidden
                  />
                  <input
                    id="explore-search"
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Project title or club…"
                    className="input-modern pl-11"
                  />
                </div>
              </label>
              <SelectField
                label="Area of focus"
                id="explore-area"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                aria-label="Filter by area of focus"
              >
                <option value="">All areas of focus</option>
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {titleCase(a)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="District"
                id="explore-district"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                aria-label="Filter by district"
              >
                <option value="">All districts</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    RID {d}
                  </option>
                ))}
              </SelectField>
            </div>
          </FilterConsole>

          {/* Results ledger line */}
          <div className="mt-10 flex items-baseline gap-4 border-b border-navy-950/10 pb-4">
            <p className="eyebrow">Results</p>
            <p className="microlabel ml-auto text-right">
              Showing <span className="figure">{fmt(filtered.length)}</span> of{" "}
              <span className="figure">{fmt(projects.length)}</span> projects
            </p>
          </div>

          {/* Visual grid */}
          {filtered.length > 0 ? (
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => (
                <ProjectCard key={c.key} p={c} />
              ))}
            </div>
          ) : (
            <EmptyState onClear={clearAll}>
              Try a different search term, or clear the area and district filters.
            </EmptyState>
          )}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

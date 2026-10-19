import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site/SiteFooter";
import { CardMedia } from "@/components/pages/projects/CardMedia";
import { OcvModuleWordButton } from "@/components/site/OcvModuleWordButton";
import { getOcvPublicModule, ocvModuleWordUrl } from "@/lib/ocvPublicModule";

/** ?yearId= — required; projects live in per-year tables so it disambiguates the club+module. */
function parseYearId(searchParams: { yearId?: string }): number | undefined {
  const n = Number(searchParams.yearId);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { clubId: string; moduleKey: string };
  searchParams: { yearId?: string };
}): Promise<Metadata> {
  const clubId = Number(params.clubId);
  const yearId = parseYearId(searchParams);
  if (!Number.isFinite(clubId) || !yearId) return { title: "Live Documents | Rotary" };
  const data = await getOcvPublicModule(clubId, yearId, params.moduleKey);
  if (!data) return { title: "Live Documents | Rotary" };
  return {
    title: `${data.header.moduleLabel} | ${data.header.clubDisplayName} | Rotary`,
    description: `${data.header.moduleLabel} projects for ${data.header.clubDisplayName}, Rotary Year ${data.header.yearLabel}.`,
  };
}

export default async function OcvLiveDocumentsPage({
  params,
  searchParams,
}: {
  params: { clubId: string; moduleKey: string };
  searchParams: { yearId?: string };
}) {
  const clubId = Number(params.clubId);
  const yearId = parseYearId(searchParams);
  const moduleKey = params.moduleKey;
  if (!Number.isFinite(clubId) || !yearId) notFound();

  const data = await getOcvPublicModule(clubId, yearId!, moduleKey);
  if (!data) notFound();

  const header = data.header;
  const wordUrl = ocvModuleWordUrl(clubId, yearId!, header.moduleKey);
  // Mirrors the server's Content-Disposition name (OcvGov word endpoint).
  const wordFileName = `OCV_${header.moduleLabel}_${header.clubName}_${header.yearLabel}.docx`
    .replace(/\s+/g, "_")
    .replace(/\//g, "-");

  const details: { label: string; value: string }[] = [
    { label: "Zone", value: header.zoneName || "–" },
    { label: "District Number", value: header.districtNumber || "–" },
    { label: "Club ID", value: header.clubRotaryId || "–" },
    { label: "President", value: header.presidentName || "–" },
    { label: "Assistant Governor", value: header.assistantGovernorName || "–" },
    { label: "Report Generated", value: header.generatedAt || "–" },
  ];

  return (
    <>
      {/* ——— Header ——— */}
      <section className="relative overflow-hidden bg-porcelain bg-glow-warm-light">
        <div className="container-rotary py-14 lg:py-20">
          <div className="rule-gold" />
          <p className="eyebrow mt-3.5">Governor&apos;s Official Visit · Live Documents</p>
          <h1 className="mt-4 max-w-4xl font-display text-display-2 font-[450] tracking-[-0.02em] text-navy-950">
            {header.moduleLabel}
          </h1>
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-muted">
            <span className="font-semibold text-navy-900">{header.clubDisplayName}</span>
            {header.yearLabel && (
              <span>
                Rotary Year <span className="figure">{header.yearLabel}</span>
              </span>
            )}
          </p>

          {/* Details grid */}
          <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-4 border-t border-navy-950/10 pt-6 sm:grid-cols-2 lg:grid-cols-3">
            {details.map((d) => (
              <div key={d.label}>
                <p className="microlabel">{d.label}</p>
                <p className="mt-1 text-[15px] font-medium text-ink">{d.value}</p>
              </div>
            ))}
          </div>

          {/* Download Word — fetches the server-generated .docx with a visible spinner (generation
              can take several seconds), then triggers the browser download. */}
          <OcvModuleWordButton wordUrl={wordUrl} fileName={wordFileName} />
        </div>
      </section>

      {/* ——— Content by module kind ——— */}
      <section className="bg-paper py-14 lg:py-20">
        <div className="container-rotary">
          <div className="rule-gold" />

          {data.kind === "projects" && (
            <>
              <p className="eyebrow mt-3.5">Projects</p>
              <h2 className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950">
                {header.moduleLabel}{" "}
                <span className="figure align-middle text-base text-muted">({data.projects.length})</span>
              </h2>
              {data.projects.length === 0 ? (
                <p className="mt-8 text-[16px] text-muted">No projects for this year.</p>
              ) : (
                <div className="mt-10 space-y-16">
                  {data.projects.map((p, idx) => (
                    <article key={idx} className="border-t border-navy-950/10 pt-10">
                      <h3 className="font-display text-[1.6rem] font-[450] leading-tight tracking-[-0.01em] text-navy-950">
                        {p.title || "Untitled Project"}
                      </h3>

                      {p.description && (
                        <p className="mt-4 max-w-[68ch] whitespace-pre-line text-[17px] leading-[1.65] text-ink/80">
                          {p.description}
                        </p>
                      )}

                      {p.fields.length > 0 && (
                        <dl className="mt-6 grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                          {p.fields.map((f) => (
                            <div key={f.label} className="border-t border-navy-950/10 pt-3">
                              <dt className="microlabel">{f.label}</dt>
                              <dd className="mt-1 text-[15px] font-medium text-ink">{f.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}

                      {p.images.length > 0 && (
                        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {p.images.map((im, i) => (
                            <figure key={i}>
                              <CardMedia
                                src={im.url}
                                alt={im.caption || p.title}
                                className="aspect-[4/3] overflow-hidden rounded-lg bg-paper-200"
                              />
                              {im.caption && (
                                <figcaption className="mt-2 text-[13px] text-muted">{im.caption}</figcaption>
                              )}
                            </figure>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {data.kind === "table" && (
            <>
              <p className="eyebrow mt-3.5">Records</p>
              <h2 className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950">
                {header.moduleLabel}{" "}
                <span className="figure align-middle text-base text-muted">({data.table.rows.length})</span>
              </h2>
              {data.table.rows.length === 0 ? (
                <p className="mt-8 text-[16px] text-muted">No records.</p>
              ) : (
                <div className="mt-8 overflow-x-auto rounded-lg border border-navy-950/10">
                  <table className="w-full border-collapse text-left text-[14px]">
                    <thead>
                      <tr className="bg-navy-950/5">
                        {data.table.headers.map((h, i) => (
                          <th key={i} className="whitespace-nowrap px-4 py-3 font-semibold text-navy-900">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.table.rows.map((row, ri) => (
                        <tr key={ri} className="border-t border-navy-950/10 align-top">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-4 py-3 text-ink/80">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {data.kind === "newsletters" && (
            <>
              <p className="eyebrow mt-3.5">Newsletters</p>
              <h2 className="mt-4 font-display text-heading font-[450] tracking-[-0.02em] text-navy-950">
                {header.moduleLabel}{" "}
                <span className="figure align-middle text-base text-muted">({data.newsletters.length})</span>
              </h2>
              {data.newsletters.length === 0 ? (
                <p className="mt-8 text-[16px] text-muted">No newsletters published for this year.</p>
              ) : (
                <ul className="mt-8 divide-y divide-navy-950/10 border-t border-navy-950/10">
                  {data.newsletters.map((n, i) => (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-4 py-5">
                      <div>
                        <p className="text-[16px] font-medium text-navy-950">{n.title || "(untitled)"}</p>
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
                          {n.publishDate && <span className="figure">{n.publishDate}</span>}
                          {n.attachmentType && <span>{n.attachmentType}</span>}
                          {n.status && <span>{n.status}</span>}
                        </p>
                      </div>
                      {n.url && (
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-ghost inline-flex min-h-11 items-center"
                        >
                          Open
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

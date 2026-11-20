import type { Metadata } from "next";
import Link from "next/link";
import PageFx from "@/components/PageFx";
import { PageHero, Scribble } from "@/components/kit";
import { HELP_LANGUAGES, helpIndex, helpLang, type HelpIndex } from "@/lib/help";
import s from "./help.module.css";

export const metadata: Metadata = {
  title: "ROW Help Centre | Guides for Roster On Wheels",
  description: "Step-by-step guides for Roster On Wheels: signing in, the app, club and district administration, communication, websites and privacy.",
};

type Search = Promise<{ q?: string; category?: string; lang?: string }>;

export default async function HelpPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const lang = helpLang(sp.lang);
  const q = (sp.q ?? "").trim().slice(0, 200);
  const category = /^[a-z0-9-]{1,80}$/.test(sp.category ?? "") ? sp.category : undefined;
  let data: HelpIndex | null = null;
  let failed = false;
  try {
    data = await helpIndex(lang, q, category);
  } catch {
    failed = true;
  }
  const filtered = !!(q || category);
  const langParam = lang === "en" ? "" : `?lang=${lang}`;

  return (
    <>
      <PageHero title={<>Help <Scribble>centre</Scribble></>} intro="Step-by-step guides for members, club officers and district teams." />
      <section className="legal" aria-label="Help articles">
        <div className="container">
          <form className={s.tools} role="search" action="/help">
            <label className={`${s.field} ${s.search}`}>
              Search the help centre
              <input className={s.input} type="search" name="q" defaultValue={q} maxLength={200} placeholder="For example: password, mass email, attendance" />
            </label>
            <label className={s.field}>
              Language
              <select className={s.input} name="lang" defaultValue={lang}>
                {HELP_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
            {category && <input type="hidden" name="category" value={category} />}
            <button className="btn btn--sm btn--primary" type="submit">Search</button>
          </form>

          {failed ? (
            <p className={s.empty}>The help centre could not be loaded just now. Please try again in a few minutes.</p>
          ) : !data || data.articles.length === 0 ? (
            <div className={s.empty}>
              <p>{filtered ? "No articles match your search. Try other words." : "There are no help articles yet."}</p>
              {filtered && <Link className="link" href={`/help${langParam}`}>See all articles</Link>}
            </div>
          ) : filtered ? (
            <div className={s.group}>
              <p className={s.muted}>
                {data.articles.length} {data.articles.length === 1 ? "article" : "articles"}
                {category && ` in ${data.categories.find((k) => k.slug === category)?.name ?? "this category"}`}.{" "}
                <Link className="link" href={`/help${langParam}`}>See all articles</Link>
              </p>
              <ArticleList items={data.articles} langParam={langParam} />
            </div>
          ) : (
            <>
              <nav className={s.cats} aria-label="Categories">
                {data.categories.map((k) => (
                  <Link key={k.slug} className={s.cat} href={`/help?category=${k.slug}${lang === "en" ? "" : `&lang=${lang}`}`}>
                    <strong>{k.name}</strong>
                    {k.description && <span className={s.muted}>{k.description}</span>}
                  </Link>
                ))}
              </nav>
              {data.categories.map((k) => (
                <section key={k.slug} className={s.group} aria-labelledby={`cat-${k.slug}`}>
                  <h2 className={s.groupTitle} id={`cat-${k.slug}`}>{k.name}</h2>
                  <ArticleList items={data.articles.filter((a) => a.categorySlug === k.slug)} langParam={langParam} />
                </section>
              ))}
            </>
          )}
        </div>
      </section>
      <PageFx />
    </>
  );
}

function ArticleList({ items, langParam }: { items: HelpIndex["articles"]; langParam: string }) {
  return (
    <ul className={s.list}>
      {items.map((a) => (
        <li key={a.slug}>
          <Link href={`/help/${a.slug}${langParam}`}>
            <strong>{a.title}</strong>
            {a.summary && <span className={s.muted}>{a.summary}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

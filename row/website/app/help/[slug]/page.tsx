import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageFx from "@/components/PageFx";
import { helpArticle, helpLang } from "@/lib/help";
import Feedback from "../Feedback";
import s from "../help.module.css";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function load({ params, searchParams }: Props) {
  const { slug } = await params;
  const lang = helpLang((await searchParams).lang);
  if (!SLUG.test(slug) || slug.length > 120) return { lang, article: null };
  return { lang, article: await helpArticle(slug, lang) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  try {
    const { article } = await load(props);
    return article ? { title: `${article.title} | ROW Help Centre`, description: article.summary ?? undefined } : { title: "ROW Help Centre" };
  } catch {
    return { title: "ROW Help Centre" };
  }
}

export default async function HelpArticlePage(props: Props) {
  const { lang, article } = await load(props);
  if (!article) notFound();
  const langParam = lang === "en" ? "" : `?lang=${lang}`;
  const catHref = `/help?category=${article.category.slug}${lang === "en" ? "" : `&lang=${lang}`}`;

  return (
    <>
      <section className="phero" aria-labelledby="page-title">
        <div className="container">
          <nav className={s.crumbs} aria-label="Breadcrumb">
            <Link className="link" href={`/help${langParam}`}>Help centre</Link>
            <Link className="link" href={catHref}>{article.category.name}</Link>
          </nav>
          <div className="phero__copy">
            <h1 className="phero__title" id="page-title">{article.title}</h1>
            {article.summary && <p className={s.muted}>{article.summary}</p>}
          </div>
        </div>
      </section>
      <section className="legal">
        <div className="container">
          {/* Sanitized by the API on save and again after translation (PublicHtml). */}
          <article className={`legal__body ${s.article}`} dangerouslySetInnerHTML={{ __html: article.body }} />
          <Feedback slug={article.slug} />
          {article.related.length > 0 && (
            <nav className={s.related} aria-labelledby="related-title">
              <h2 className={s.groupTitle} id="related-title">Related articles</h2>
              <ul className={s.list}>
                {article.related.map((r) => (
                  <li key={r.slug}><Link href={`/help/${r.slug}${langParam}`}><strong>{r.title}</strong></Link></li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </section>
      <PageFx />
    </>
  );
}

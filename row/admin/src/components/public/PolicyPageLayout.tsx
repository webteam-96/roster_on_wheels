"use client";

/**
 * Shared shell for policy pages (Contact Us / Terms / Refunds / Privacy /
 * About). Renders the public header + a constrained article container +
 * the public footer. The root layout's <main className="px-8 py-4"> wrapper
 * is escaped via negative margins so sections can be full-bleed.
 */

import { ReactNode } from "react";
import PublicHeader from "./PublicHeader";
import PublicFooter from "./PublicFooter";

interface Props {
  title: string;
  /** Optional update line shown below the title (e.g. "Last updated: 5 June 2026"). */
  updated?: string;
  /** Short intro / subtitle. */
  intro?: string;
  children: ReactNode;
}

export default function PolicyPageLayout({ title, updated, intro, children }: Props) {
  return (
    <div className="-mx-8 -my-4 bg-slate-50 min-h-screen">
      <PublicHeader />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: "#17458f" }}>
            {title}
          </h1>
          {updated && (
            <p className="text-xs text-slate-500 mt-2">{updated}</p>
          )}
          {intro && (
            <p className="text-base text-slate-600 mt-4 leading-relaxed">{intro}</p>
          )}
        </header>
        <article className="prose prose-slate max-w-none prose-headings:text-slate-800 prose-h2:text-xl prose-h2:font-semibold prose-h2:mt-8 prose-h2:mb-3 prose-h3:text-base prose-h3:font-semibold prose-h3:mt-6 prose-h3:mb-2 prose-p:text-slate-700 prose-p:leading-relaxed prose-li:text-slate-700 prose-li:leading-relaxed prose-a:text-blue-700 prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-900">
          {children}
        </article>
      </main>
      <PublicFooter />
    </div>
  );
}

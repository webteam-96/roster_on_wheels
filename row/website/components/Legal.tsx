import type { ReactNode } from "react";
import Link from "next/link";
import PageFx from "@/components/PageFx";
import { LEGAL } from "@/lib/site";

// The policy pages' shared frame: the title, the text, then links to the other two.
export default function Legal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <section className="phero" aria-labelledby="page-title">
        <div className="container">
          <div className="phero__copy">
            <h1 className="phero__title" id="page-title">{title}</h1>
          </div>
        </div>
      </section>
      <section className="legal">
        <div className="container">
          <div className="legal__body">{children}</div>
          <nav className="legal__more" aria-label="Policies">
            {LEGAL.filter((l) => l.label !== title).map((l) => (
              <Link key={l.href} className="link" href={l.href}>{l.label}</Link>
            ))}
          </nav>
        </div>
      </section>
      <PageFx />
    </>
  );
}

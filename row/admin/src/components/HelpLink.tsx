"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookOpen } from "@/components/icons";
import { useLocaleControl } from "@/i18n/IntlProvider";
import { getHelpForPage } from "@/services/api";
import { helpArticleUrl, helpContextPath } from "@/lib/helpCentre";

/** Header "Help" link to the published help article for the current admin page; hidden when there is none. */
export default function HelpLink() {
  const pathname = usePathname() ?? "/";
  const { locale } = useLocaleControl();
  const [article, setArticle] = useState<{ slug: string; title: string } | null>(null);

  useEffect(() => {
    let live = true;
    getHelpForPage(helpContextPath(pathname), locale).then((a) => { if (live) setArticle(a); }).catch(() => { if (live) setArticle(null); });
    return () => { live = false; };
  }, [pathname, locale]);

  if (!article) return null;
  return (
    <Button variant="ghost" size="sm" asChild>
      <a href={`${helpArticleUrl(article.slug)}?lang=${encodeURIComponent(locale)}`} target="_blank" rel="noopener noreferrer" title={article.title}>
        <BookOpen className="h-4 w-4" />
        Help
      </a>
    </Button>
  );
}

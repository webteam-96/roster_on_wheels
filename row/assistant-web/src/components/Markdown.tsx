import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { PHOTO_BASE_URL } from "@/lib/api";

// SECURITY: assistant output is untrusted (it may echo prompt-injected content from the data).
// Rendering rules — keep them:
//   • No rehype-raw and `skipHtml`: raw HTML in the markdown is dropped, never parsed.
//   • No dangerouslySetInnerHTML anywhere in this app.
//   • Images load only for project-photo paths ("/Documents/gallery/Group<id>/…/<file>.jpg") served by
//     our own API (PHOTO_BASE_URL). Any other image (remote URL, tracking pixel) shows its alt text only.
//   • Links are live only for https URLs on the Rotary hosts below; anything else is plain text.

const ALLOWED_LINK_HOSTS = ["rosteronwheels.com", "rotary.org"];

const PHOTO_PATH = /^\/Documents\/gallery\/Group\d+\/(?:\d{4}_\d{2}\/)?Album\d+\/[A-Za-z0-9_.-]{1,120}\.(?:jpe?g|png|webp|gif)$/i;

export function photoUrl(src: string | undefined): string | null {
  if (!src || src.includes("..") || !PHOTO_PATH.test(src)) return null;
  return `${PHOTO_BASE_URL}${src}`;
}

export function isAllowedLink(href: string | undefined): boolean {
  if (!href) return false;
  let url: URL;
  try {
    url = new URL(href); // relative / malformed hrefs throw → not a link
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const components: Components = {
  a: ({ href, children }) =>
    isAllowedLink(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) => {
    const url = photoUrl(typeof src === "string" ? src : undefined);
    if (!url) return alt ? <span className="italic text-slate-500">[{alt}]</span> : null;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="my-1 mr-2 inline-block align-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt || "Project photo"}
          title={alt || undefined}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-40 w-auto max-w-full rounded-lg border border-slate-200 object-cover"
        />
      </a>
    );
  },
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold text-navy-900 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold text-navy-900 first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-3 font-semibold text-navy-900 first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-4 border-gold-500 bg-gold-50 px-3 py-1 text-slate-700">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-slate-200" />,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-navy-50 text-navy-900">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-slate-100 last:border-0 even:bg-slate-50/60">{children}</tr>,
  th: ({ children, style }) => (
    <th style={style} className="whitespace-nowrap px-3 py-2 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="px-3 py-2 align-top">
      {children}
    </td>
  ),
};

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
      {children}
    </ReactMarkdown>
  );
}

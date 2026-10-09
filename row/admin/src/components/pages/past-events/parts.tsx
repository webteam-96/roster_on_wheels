import { ArrowUpRight, Camera, Play } from "lucide-react";
import { YoutubeIcon } from "@/components/icons/SocialIcons";

export type EventButtonData = {
  label: string;
  kind?: "video" | "photos";
  full?: boolean;
  /** Real media URL (from the live site); missing = rendered as a disabled placeholder. */
  url?: string;
  /** "link" renders a plain text link with an arrow (e.g. "View All Videos"). */
  variant?: "link";
};

/** Extract a YouTube video id (youtu.be/… or youtube.com/watch?v=…) for thumbnails. */
function ytId(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=)([\w-]{11})/);
  return m ? m[1] : null;
}

/** Platform icon well — used when a row has no YouTube thumbnail. */
function IconWell({ kind = "video" }: { kind?: "video" | "photos" }) {
  return (
    <span className="flex aspect-video w-24 flex-none items-center justify-center rounded-lg bg-porcelain text-gold-deep sm:w-28">
      {kind === "photos" ? (
        <Camera className="h-5 w-5" strokeWidth={1.75} />
      ) : (
        <YoutubeIcon className="h-5 w-5" />
      )}
    </span>
  );
}

/**
 * One media affordance as a LEDGER ROW: YouTube thumbnail (or platform icon
 * well), wrapping label, kind tag, external-link arrow. Rows without a URL
 * (e.g. "Coming soon") render as muted text — never dead links.
 */
export function EventButton({
  label,
  kind = "video",
  url,
  animate = false,
}: EventButtonData & { animate?: boolean }) {
  const id = ytId(url);
  const motion = animate
    ? { "data-animate": "left", "data-animate-duration": "0.35" }
    : {};

  if (!url) {
    return (
      <span
        aria-disabled="true"
        className="flex items-center gap-4 border-b border-navy-950/10 py-3 pr-1 text-ink/40"
        {...motion}
      >
        <span className="flex aspect-video w-24 flex-none items-center justify-center rounded-lg bg-porcelain text-ink/30 sm:w-28">
          <Play className="ml-0.5 h-4 w-4" fill="currentColor" strokeWidth={0} />
        </span>
        <span className="flex-1 text-[14px] font-medium leading-snug">{label}</span>
        <span className="microlabel !text-[10px] !text-ink/35">Coming soon</span>
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="ledger-row group flex items-center gap-4 py-3 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark"
      {...motion}
    >
      {id ? (
        <span className="media-grade w-24 flex-none rounded-lg sm:w-28">
          {/* Third-party host — plain img keeps it outside next/image domains. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
            alt=""
            loading="lazy"
            className="aspect-video w-full rounded-lg object-cover"
          />
        </span>
      ) : (
        <IconWell kind={kind} />
      )}
      <span className="flex-1 text-[14px] font-medium leading-snug text-ink transition-colors group-hover:text-navy-950">
        {label}
      </span>
      <span className="microlabel hidden !text-[10px] sm:block">
        {kind === "photos" ? "Gallery" : "Video"}
      </span>
      <ArrowUpRight className="h-4 w-4 flex-none text-muted transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-gold-deep" />
    </a>
  );
}

/** Every media affordance in one ledger list — LEDGER SWEEP entrance. */
export function ButtonGroup({ buttons }: { buttons: EventButtonData[] }) {
  if (!buttons.length) return null;
  return (
    <div data-animate-stagger="left" className="border-t border-navy-950/10">
      {buttons.map((b, i) => (
        <EventButton key={i} {...b} animate />
      ))}
    </div>
  );
}

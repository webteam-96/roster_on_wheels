import Link from "next/link";
import { FooterBottomBar } from "@/components/site/FooterBottomBar";
import { Logo } from "@/components/site/Logo";
import {
  FacebookIcon,
  InstagramIcon,
  YoutubeIcon,
} from "@/components/icons/SocialIcons";

// Only socials with real destinations — dead icons erode trust.
const SOCIALS = [
  { label: "Facebook", href: "https://facebook.com/rotaryindia1.org", Icon: FacebookIcon },
  { label: "Instagram", href: "https://instagram.com/rizones4567", Icon: InstagramIcon },
  { label: "YouTube", href: "https://youtube.com/@rizones4567", Icon: YoutubeIcon },
];

const QUICK_LINKS = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about-us" },
  { label: "Projects", href: "/projects" },
  { label: "Tutorial", href: "/tutorial" },
  { label: "Websites", href: "/websites" },
  { label: "Contact", href: "/contact-us" },
];

const RESOURCES = [
  { label: "Download App", href: "/download" },
  { label: "Zonal Events", href: "/past-events" },
  { label: "Upcoming Events", href: "/events" },
  { label: "Admin Login", href: "https://rizones45678.org/login" },
];

/**
 * Site footer, one dark register that flows into the bottom bar: brand +
 * tagline + socials, two link columns, over a midnight wash with a gold
 * hairline and a faint royal glow to echo the galaxy hero.
 *
 * Every page MUST render <SiteFooter /> (or <PageFooter />) as its final
 * section.
 */
export function PageFooter() {
  return (
    <footer className="relative overflow-hidden bg-midnight text-cream">
      {/* Gold hairline + soft royal glow — quiet nod to the hero sky */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 left-1/2 h-64 w-[42rem] -translate-x-1/2 rounded-full bg-royal/20 blur-3xl"
      />

      <div className="container-rotary relative grid gap-12 py-16 md:grid-cols-2 lg:grid-cols-[1.8fr_1fr_1.4fr]">
        <div>
          <Logo tone="inverse" />
          <p className="mt-5 max-w-xs text-[14px] leading-relaxed text-cream/60">
            Uniting Clubs | Inspiring Leaders | Transforming Lives
          </p>
          <div className="mt-6 flex items-center gap-2">
            {SOCIALS.map(({ label, href, Icon }) => (
              <Link
                key={label}
                href={href}
                aria-label={label}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-full text-cream/60 ring-1 ring-cream/15 transition-all duration-300 hover:bg-gold hover:text-midnight hover:ring-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <Icon className="h-4 w-4" />
              </Link>
            ))}
          </div>
        </div>

        <FooterColumn title="Quick Links" links={QUICK_LINKS} />
        <FooterColumn title="Resources" links={RESOURCES} />
      </div>

      <FooterBottomBar />
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h3 className="microlabel-gold">{title}</h3>
      <ul className="mt-5 space-y-3">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="group inline-flex items-center gap-2 rounded-sm text-[14px] text-cream/60 transition-colors duration-200 hover:text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <span className="h-px w-3 bg-gold/50 transition-all duration-300 group-hover:w-5 group-hover:bg-gold" />
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

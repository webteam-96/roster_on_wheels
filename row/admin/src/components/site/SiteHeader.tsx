"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Menu, X } from "@/components/icons";
import { Logo } from "@/components/site/Logo";
import {
  FacebookIcon,
  InstagramIcon,
  YoutubeIcon,
} from "@/components/icons/SocialIcons";
import { cn } from "@/lib/utils";

type NavChild = { label: string; href: string };
type NavItem = { label: string; href?: string; children?: NavChild[] };

const NAV: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about-us" },
  { label: "Projects", href: "/projects" },
  {
    label: "ROW",
    children: [
      { label: "Our Leaders", href: "/our-leaders" },
      { label: "Web Committee", href: "/committee" },
      { label: "District Governors", href: "/district-governors" },
      { label: "Regional Leaders", href: "/regional-leaders" },
    ],
  },
  { label: "Zonal Events", href: "/past-events" },
  { label: "User Manual", href: "https://digitals-private-organization.gitbook.io/portal.example.org" },
  {
    label: "Member Centre",
    children: [
      { label: "Tutorial", href: "/tutorial" },
      { label: "Download App", href: "/download" },
    ],
  },
  // ponytail: hidden for now — restore this line to re-show the nav link
  // { label: "Prospective Member", href: "/prospective-member" },
];

const ADMIN_LOGIN_URL = "/login";

// Socials live in the mobile sheet foot (and the footer) — TopBar retired.
const SOCIALS = [
  { label: "Instagram", href: "https://instagram.com/ROW", Icon: InstagramIcon },
  { label: "YouTube", href: "https://youtube.com/@ROW", Icon: YoutubeIcon },
];

/**
 * One 76px light-glass bar over paper; condenses to 60px with a stronger
 * blur + hairline on scroll. Mixed-case Inter 500 nav, 2px gold underline
 * for the active route, dark-glass dropdowns, and an Admin Login CTA
 * (also inside the Member Centre dropdown). Mobile: full-screen
 * dark-glass sheet with serif nav items and a staggered reveal.
 */
export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setOpenMenu(null);
  }, [pathname]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Lock body scroll behind the full-screen sheet.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const isActive = (href?: string) =>
    href && (href === "/" ? pathname === "/" : pathname.startsWith(href));

  // External nav links (absolute URLs) open in a new tab.
  const external = (href?: string) =>
    href?.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {};

  const linkClass = (active: boolean | "" | undefined) =>
    cn(
      "relative rounded-md px-3 py-2 text-[13px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark",
      // 2px gold underline, offset ~6px below the label
      "after:absolute after:inset-x-3 after:bottom-0.5 after:h-[2px] after:rounded-full after:bg-gold after:opacity-0 after:transition-opacity after:duration-200",
      active ? "text-navy-950 after:opacity-100" : "text-ink/75 hover:text-navy-950 hover:after:opacity-50"
    );

  const dropdownItemClass = (active: boolean | "" | undefined) =>
    cn(
      "block rounded-xl px-3.5 py-2.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold",
      active ? "bg-cream/10 text-gold" : "text-cream/75 hover:bg-cream/10 hover:text-cream"
    );

  return (
    <>
    <header
      className={cn(
        // Fixed, not sticky: the bar condenses 76->60px on scroll, and a sticky
        // header's height change reflows the whole page mid-scroll (content
        // jerks against the scroll direction). Fixed + the constant spacer
        // below keeps the document height stable, so the condense is pure paint.
        "fixed inset-x-0 top-0 z-50 border-b transition-all duration-300 ease-out-expo",
        scrolled
          ? "border-navy-950/[0.10] bg-paper/[0.85] shadow-soft backdrop-blur-xl"
          : "border-transparent bg-paper/[0.72] backdrop-blur-md"
      )}
    >
      <div
        className={cn(
          "container-wide flex items-center justify-between gap-6 transition-all duration-300 ease-out-expo",
          scrolled ? "h-[60px]" : "h-[76px]"
        )}
      >
        <Logo />

        {/* Desktop nav */}
        <nav ref={navRef} className="hidden items-center gap-1 xl:flex" aria-label="Primary">
          {NAV.map((item) =>
            item.children ? (
              <div
                key={item.label}
                className="relative"
                onMouseEnter={() => setOpenMenu(item.label)}
                onMouseLeave={() => setOpenMenu((m) => (m === item.label ? null : m))}
              >
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === item.label}
                  onClick={() => setOpenMenu((m) => (m === item.label ? null : item.label))}
                  className={cn(linkClass(openMenu === item.label), "flex items-center gap-1.5")}
                >
                  {item.label}
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 text-ink/40 transition-transform duration-200",
                      openMenu === item.label && "rotate-180"
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "absolute left-0 top-full z-50 min-w-[290px] pt-3 transition-all duration-200 ease-out-expo",
                    openMenu === item.label
                      ? "visible translate-y-0 opacity-100"
                      : "invisible translate-y-1 opacity-0"
                  )}
                >
                  {/* Dark-glass panel — the brand register, not a white popover */}
                  <div className="overflow-hidden rounded-2xl bg-midnight/[0.92] p-2 shadow-lift ring-1 ring-cream/10 backdrop-blur-xl">
                    {item.children.map((c) => (
                      <Link
                        key={c.label}
                        href={c.href}
                        className={dropdownItemClass(isActive(c.href))}
                      >
                        {c.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <Link
                key={item.label}
                href={item.href!}
                {...external(item.href)}
                className={linkClass(isActive(item.href))}
              >
                {item.label}
              </Link>
            )
          )}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={ADMIN_LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost hidden !min-h-10 !px-5 !py-2 md:inline-flex"
          >
            Admin Login
          </a>

          {/* Mobile trigger */}
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full text-navy-950 transition-colors hover:bg-navy-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-dark xl:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

    </header>

    {/* Constant-height flow spacer for the fixed bar — sized to the expanded
        (76px) state so page content sits exactly where the sticky version put it. */}
    <div aria-hidden className="h-[76px]" />

    {/* Mobile nav — full-screen dark-glass sheet. Rendered as a SIBLING of the
        header, never inside it: the header's backdrop-filter makes it the
        containing block for fixed descendants, which would trap this
        "inset-0" sheet inside the 76px bar. Closes with a plain conditional —
        no AnimatePresence exit: app-router navigations can strand the exiting
        overlay at opacity 0, leaving an invisible tap-blocking layer. */}
      {mobileOpen && (
          <motion.div
            initial={reduce ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduce ? 0 : 0.25 }}
            className="fixed inset-0 z-[70] flex flex-col bg-midnight/[0.94] text-cream backdrop-blur-xl xl:hidden"
          >
            <div className="container-wide flex h-[76px] shrink-0 items-center justify-between">
              <Logo tone="inverse" />
              <button
                type="button"
                autoFocus
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-cream transition-colors hover:bg-cream/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav aria-label="Mobile" className="min-h-0 flex-1 overflow-y-auto">
              <div className="container-wide flex flex-col gap-6 py-8">
                {NAV.map((item, i) => (
                  <motion.div
                    key={item.label}
                    initial={reduce ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: reduce ? 0 : 0.08 + i * 0.05,
                      duration: reduce ? 0 : 0.45,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    {item.children ? (
                      <div>
                        <p className="microlabel-on-dark">{item.label}</p>
                        <div className="mt-3 flex flex-col gap-1">
                          {item.children.map((c) => (
                            <Link
                              key={c.label}
                              href={c.href}
                              onClick={() => setMobileOpen(false)}
                              className={cn(
                                "rounded-md py-1 text-[17px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
                                isActive(c.href) ? "text-gold" : "text-cream/80 hover:text-cream"
                              )}
                            >
                              {c.label}
                            </Link>
                          ))}
                          {item.label === "Member Centre" && (
                            <Link
                              href={ADMIN_LOGIN_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-md py-1 text-[17px] leading-snug text-cream/80 transition-colors hover:text-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                            >
                              Admin Login
                            </Link>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Link
                        href={item.href!}
                        {...external(item.href)}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "block rounded-md font-display text-heading font-[450] tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
                          isActive(item.href) ? "text-gold" : "text-cream hover:text-gold"
                        )}
                      >
                        {item.label}
                      </Link>
                    )}
                  </motion.div>
                ))}
              </div>
            </nav>

            {/* Foot: socials */}
            <div className="shrink-0 border-t border-cream/10">
              <div className="container-wide flex items-center gap-4 py-4">
                <div className="flex items-center gap-1">
                  {SOCIALS.map(({ label, href, Icon }) => (
                    <Link
                      key={label}
                      href={href}
                      aria-label={label}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-10 w-10 items-center justify-center rounded-full text-cream/70 ring-1 ring-cream/15 transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    >
                      <Icon className="h-4 w-4" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
      )}
    </>
  );
}

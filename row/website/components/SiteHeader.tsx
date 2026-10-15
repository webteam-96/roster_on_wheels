"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import Logo from "./Logo";
import Image from "next/image";
import licensee from "@/public/brand/rotary-official-licensee.png";
import { NAV, DEMO_HREF, DEMO_LABEL, LOGIN_HREF, LOGIN_LABEL } from "@/lib/site";

declare global {
  interface Window {
    rowLenis: Lenis | null;
  }
}

const EASE_INOUT = "power3.inOut";
const SPRING = "back.out(1.6)";

// Header (shrinks after 80px), the full-screen menu and Lenis smooth scrolling.
// They live in the layout, so they survive page navigations.
export default function SiteHeader() {
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const setMenuRef = useRef<(open: boolean, returnFocus?: boolean) => void>(() => {});

  useEffect(() => {
    const header = headerRef.current;
    const burger = burgerRef.current;
    const menu = menuRef.current;
    if (!header || !burger || !menu) return;
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncHeader = () => header.classList.toggle("is-scrolled", window.scrollY > 80);
    window.addEventListener("scroll", syncHeader, { passive: true });
    syncHeader();

    // Lenis on fine pointers only, and never when reduced motion is asked for
    let stopLenis = () => {};
    if (window.matchMedia("(pointer: fine)").matches && !reduced.matches) {
      gsap.registerPlugin(ScrollTrigger);
      const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
      window.rowLenis = lenis;
      lenis.on("scroll", ScrollTrigger.update);
      const raf = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
      stopLenis = () => {
        gsap.ticker.remove(raf);
        lenis.destroy();
        window.rowLenis = null;
        gsap.ticker.lagSmoothing(500, 33);
      };
    }

    const centre = () => {
      const b = burger.getBoundingClientRect();
      return `${Math.round(b.left + b.width / 2)}px ${Math.round(b.top + b.height / 2)}px`;
    };
    const setMenu = (open: boolean, returnFocus = true) => {
      if (open === openRef.current) return;
      openRef.current = open;
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      root.classList.toggle("menu-open", open);
      if (open) {
        window.rowLenis?.stop();
        menu.hidden = false;
        if (!reduced.matches) {
          const at = centre();
          gsap.fromTo(menu, { clipPath: `circle(0px at ${at})` },
            { clipPath: `circle(150% at ${at})`, duration: 0.65, ease: EASE_INOUT, overwrite: true, clearProps: "clipPath" });
          // opacity, not autoAlpha: hidden links could not take the focus handed to the first one below
          gsap.fromTo(menu.querySelectorAll(".menu__link, .menu__ctas > *"), { y: 28, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.6, ease: SPRING, stagger: 0.035, delay: 0.12, overwrite: true, clearProps: "transform" });
        }
        menu.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true });
      } else {
        window.rowLenis?.start();
        const hide = () => {
          menu.hidden = true;
          gsap.set(menu, { clearProps: "clipPath,opacity,visibility" });
        };
        if (!reduced.matches) {
          gsap.to(menu, { clipPath: `circle(0px at ${centre()})`, duration: 0.45, ease: EASE_INOUT, overwrite: true, onComplete: hide });
        } else hide();
        if (returnFocus) burger.focus();
      }
    };
    setMenuRef.current = setMenu;

    const onBurger = () => setMenu(!openRef.current);
    burger.addEventListener("click", onBurger);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openRef.current) setMenu(false);
        return;
      }
      if (e.key === "Tab" && openRef.current) {
        const stops = [burger, ...Array.from(menu.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"))];
        const i = stops.indexOf(document.activeElement as HTMLElement);
        if (i === -1) { e.preventDefault(); stops[0].focus(); }
        else if (e.shiftKey && i === 0) { e.preventDefault(); stops[stops.length - 1].focus(); }
        else if (!e.shiftKey && i === stops.length - 1) { e.preventDefault(); stops[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("scroll", syncHeader);
      burger.removeEventListener("click", onBurger);
      document.removeEventListener("keydown", onKey);
      root.classList.remove("menu-open");
      stopLenis();
    };
  }, []);

  // Back and Forward keep the browser's own scroll restoring, and so does the first load (a reload stays put);
  // only following a link resets the scroll below.
  const poppedRef = useRef(false);
  const firstRef = useRef(true);
  useEffect(() => {
    const onPop = () => { poppedRef.current = true; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A navigation closes the menu; focus belongs to the new page, not the burger. The new page starts at its top, or
  // at its #section: Lenis keeps its own scroll position and would otherwise carry the old page's position over.
  useEffect(() => {
    setMenuRef.current(false, false);
    if (firstRef.current) { firstRef.current = false; return; }
    if (poppedRef.current) { poppedRef.current = false; return; }
    const id = decodeURIComponent(window.location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    const y = target ? target.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(target).scrollMarginTop) || 0) : 0;
    if (window.rowLenis) window.rowLenis.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo({ top: y, behavior: "instant" });
  }, [pathname]);

  const close = () => setMenuRef.current(false, false);

  return (
    <>
      <header className="site-header" data-header ref={headerRef}>
        <div className="header__inner">
          <Link className="brand" href="/" aria-label="Roster On Wheels, home">
            <Logo priority />
          </Link>
          <Image className="licensee" src={licensee} alt="Rotary Official Licensee" priority />
          <div className="header__right">
            <div className="header__ctas">
              <Link className="btn btn--gold btn--sm header__demo" href={DEMO_HREF}>{DEMO_LABEL}</Link>
              <Link className="btn btn--primary btn--sm" href={LOGIN_HREF}>{LOGIN_LABEL}</Link>
            </div>
            <button ref={burgerRef} className="burger" type="button" aria-expanded="false" aria-controls="site-menu" aria-label="Open menu" data-burger>
              <span className="burger__bars" aria-hidden="true"><i /><i /><i /></span>
            </button>
          </div>
        </div>
        <div className="header__row2">
          <div className="header__row2-inner">
            <nav className="topnav" aria-label="Main">
              <ul className="topnav__list">
                {NAV.map((n) => (
                  <li key={n.href}>
                    <Link className="topnav__link" href={n.href} aria-current={pathname === n.href ? "page" : undefined}>{n.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      </header>

      <div className="menu" id="site-menu" hidden data-menu ref={menuRef}>
        <div className="menu__inner">
          <nav className="menu__nav" aria-label="Main">
            <ul>
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link className="menu__link" href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={close}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="menu__ctas">
            <Link className="btn btn--gold btn--lg" href={DEMO_HREF} onClick={close}>{DEMO_LABEL}</Link>
            <Link className="btn btn--primary btn--lg" href={LOGIN_HREF} onClick={close}>{LOGIN_LABEL}</Link>
          </div>
        </div>
      </div>
    </>
  );
}

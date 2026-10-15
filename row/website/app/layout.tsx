import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Loader from "@/components/Loader";

// Brand typography: Inter (its optical-size axis gives Inter Display at headline sizes).
const inter = Inter({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Roster On Wheels | Rotary Club and District Management Tool",
  description:
    "Roster On Wheels (ROW) is a simple club and district management tool for Rotary: member app, club website, dues and events. USD 10 per member a year.",
};

export const viewport: Viewport = {
  themeColor: "#F7F9FC",
};

// Runs inline, before first paint. Pre-reveal states (hidden until animated) apply only under
// html.js; if the page script never starts, the class comes off after 3s and everything shows.
// html.row-loader shows the handshake loader on the first page of a visit.
const BOOT =
  "var d=document.documentElement;d.classList.add('js');setTimeout(function(){if(!window.__rowReady)d.classList.remove('js')},3000);" +
  "try{if(!sessionStorage.getItem('row-loader')){sessionStorage.setItem('row-loader','1');d.classList.add('row-loader')}}catch(e){}";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
        <Loader />
        <a className="skip-link" href="#main">Skip to content</a>
        <SiteHeader />
        <main id="main" tabIndex={-1}>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}

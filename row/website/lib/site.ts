// The V2 content doc's pages ("ROW Website Content V2 Updated.docx"): Home and About Us first, then the rest in doc order.
export const NAV = [
  { href: "/", label: "Home" },
  { href: "/about-us", label: "About Us" },
  { href: "/club-management", label: "Club Management" },
  { href: "/district-management", label: "District Management" },
  { href: "/mobile-app", label: "Mobile App" },
  { href: "/pricing", label: "Pricing" },
  { href: "/how-to-get-started", label: "How to Get Started" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact-us", label: "Contact Us" },
] as const;

// Every demo button opens the Contact Us demo form.
export const DEMO_HREF = "/contact-us#book-a-free-demo";
export const DEMO_LABEL = "Book a free demo";

// Contact Us page details (V2 doc).
export const PHONES = ["+91 84240 64369", "+91 89287 55144"] as const;
export const EMAIL = "support@rosteronwheels.com";

// ROW app store pages (from the current rosteronwheels.com).
export const APP_STORE = "https://apps.apple.com/app/roster-on-wheels/id1517823773";
export const GOOGLE_PLAY = "https://play.google.com/store/apps/details?id=com.KaizenInfo.row";

// Header sign-in → the ROW web application (admin portal, row/admin) login page.
// Set NEXT_PUBLIC_ADMIN_LOGIN_URL to the full login URL, or NEXT_PUBLIC_PORTAL_ORIGIN to the portal origin
// (its "/login" is used). Same convention as the club website's AdminLoginLink.
const PORTAL_ORIGIN = (process.env.NEXT_PUBLIC_PORTAL_ORIGIN ?? "").replace(/\/$/, "");
export const LOGIN_HREF =
  process.env.NEXT_PUBLIC_ADMIN_LOGIN_URL ||
  (PORTAL_ORIGIN ? `${PORTAL_ORIGIN}/login` : "http://localhost:3000/login");
export const LOGIN_LABEL = "Login";


// Social profiles, taken from the current rosteronwheels.com footer.
export const SOCIAL = [
  { label: "Facebook", href: "https://www.facebook.com/RosterOnWheels/" },
  { label: "X (Twitter)", href: "https://twitter.com/RosterOnWheels" },
  { label: "YouTube", href: "https://www.youtube.com/channel/UCwc_3-Vrw_Yj5AETWZVKEfw" },
  { label: "Pinterest", href: "https://in.pinterest.com/followkaizen/" },
] as const;

export const KAIZEN_HREF = "https://www.kaizeninfotech.com/";

// Policy pages (adapted from Kaizen Infotech's own policies), linked in the footer
export const LEGAL = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms-of-service", label: "Terms of Service" },
  { href: "/refund-policy", label: "Refund Policy" },
] as const;

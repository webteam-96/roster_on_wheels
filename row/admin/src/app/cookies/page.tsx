import type { Metadata } from "next";
import PolicyPageLayout from "@/components/public/PolicyPageLayout";
import { getServerBrand } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrand();
  return {
    title: `Cookies and browser storage | ${brand.productName}`,
    description: `What the ${brand.productName} portal stores in your browser and why.`,
  };
}

/**
 * Factual list of what the portal keeps in the browser (master plan WS7, Brand.legal.cookiesUrl).
 * Keep it in step with the code: every cookie / localStorage / sessionStorage key the app writes.
 * The legal wording around it comes from the instance's counsel (master plan Q6).
 */
export default async function CookiesPage() {
  const brand = await getServerBrand();
  return (
    <PolicyPageLayout
      title="Cookies and browser storage"
      intro={`The ${brand.productName} portal uses one cookie and your browser's local storage only to keep you signed in, remember your choices and make pages load faster. It uses no advertising or third-party tracking cookies.`}
    >
      <section>
        <h2>1. Cookie</h2>
        <ul>
          <li>
            <strong>NEXT_LOCALE</strong>: the language you chose in the portal, so pages open in that language next time.
            Strictly necessary for the language setting; kept until you change the language or clear your browser data.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. Local storage (kept until you sign out or clear browser data)</h2>
        <ul>
          <li><strong>auth_token, session_expiry, session_duration_ms</strong>: your signed-in session and when it ends. Strictly necessary.</li>
          <li><strong>dashboard_available_v2, modules_coming_soon, da_active_club</strong>: which dashboards and modules you can open, and the club you last worked on, so the menu loads without waiting.</li>
          <li><strong>dashboard-theme, directory_page_size</strong>: display preferences you chose.</li>
          <li><strong>rotary-project-stats-overview-v1</strong>: cached public project statistics, so the projects page loads faster.</li>
        </ul>
      </section>

      <section>
        <h2>3. Session storage (cleared when you close the tab)</h2>
        <ul>
          <li><strong>brand_v1</strong>: the portal&apos;s name, logo and contact details for this visit.</li>
          <li><strong>dashboardYearPicked, agDashboardYearPicked, club_dash_return_to</strong>: the Rotary year and page you were on, so the dashboard keeps your place.</li>
          <li><strong>rotary:projectSwitchDraft</strong>: an unsaved project form while you switch between project types.</li>
        </ul>
      </section>

      <section>
        <h2>4. Your choices</h2>
        <p>
          All of the above are needed for the portal to work or remember settings you made, so no consent banner is shown
          for them. You can remove them at any time by signing out and clearing your browser&apos;s site data for this portal.
          {brand.support.privacyEmail && (
            <>
              {" "}Questions: <a href={`mailto:${brand.support.privacyEmail}`}>{brand.support.privacyEmail}</a>.
            </>
          )}
        </p>
      </section>
    </PolicyPageLayout>
  );
}

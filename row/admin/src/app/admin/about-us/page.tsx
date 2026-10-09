import type { Metadata } from "next";
import PolicyPageLayout from "@/components/public/PolicyPageLayout";
import { merchantFrom } from "@/lib/merchantInfo";
import { getServerBrand } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrand();
  return {
    title: `About Us — ${brand.productName}`,
    description:
      `About the ${brand.productName} administration platform — who we are, what we do, and the values that guide us.`,
  };
}

export default async function AboutPage() {
  const MERCHANT = merchantFrom(await getServerBrand());
  return (
    <PolicyPageLayout
      title="About Us"
      intro="An integrated administration platform serving Rotary clubs across Zones 4, 5, 6, 7 & 8 in India."
    >
      <section>
        <h2>Who We Are</h2>
        <p>
          {MERCHANT.legalName} is the technology initiative that operates this
          Platform. It serves Rotary International&apos;s Districts grouped
          under Zones 4, 5, 6, 7 and 8 — covering a substantial portion of
          Rotary&apos;s activity across the Indian subcontinent.
        </p>
      </section>

      <section>
        <h2>What We Do</h2>
        <p>
          We provide secure digital tools that help Rotary clubs and districts
          to:
        </p>
        <ul>
          <li>Maintain accurate member records and a searchable directory;</li>
          <li>Document club service projects with photographs and impact data;</li>
          <li>Manage District-level events, registrations, and attendance;</li>
          <li>Collect annual Club Dues, event fees, and voluntary contributions in INR through a secure payment gateway;</li>
          <li>Generate statutory reports for Rotary International and internal Rotary administration;</li>
          <li>Surface live dashboards for Club Admins, Assistant Governors, District Admins, and RI Directors.</li>
        </ul>
      </section>

      <section>
        <h2>Who We Serve</h2>
        <ul>
          <li>Members of Rotary clubs across Zones 4-8 in India;</li>
          <li>Club Presidents, Secretaries, Treasurers, Directors, and other office-bearers;</li>
          <li>District Governors, District Administrators, Assistant Governors;</li>
          <li>Rotary International Directors and Rotary Foundation administrators;</li>
          <li>Donors who wish to contribute to a Rotary service project or to The Rotary Foundation.</li>
        </ul>
      </section>

      <section>
        <h2>Our Values</h2>
        <ul>
          <li><strong>Service Above Self</strong> — the platform exists for the benefit of Rotarians, not for profit.</li>
          <li><strong>Transparency</strong> — clear pricing, clear policies, clear receipts.</li>
          <li><strong>Security</strong> — encryption in transit and at rest; minimal data collection; least-privilege access.</li>
          <li><strong>Compliance</strong> — alignment with Indian IT, consumer-protection, and data-protection law and Rotary International&apos;s policies.</li>
        </ul>
      </section>

      <section>
        <h2>Get in Touch</h2>
        <p>
          Sign in with the credentials provided by your Club Secretary, or
          reach the team via the <a href="/contact-us">Contact Us</a> page.
        </p>
      </section>
    </PolicyPageLayout>
  );
}

import type { Metadata } from "next";
import PolicyPageLayout from "@/components/public/PolicyPageLayout";
import { MERCHANT } from "@/lib/merchantInfo";

export const metadata: Metadata = {
  title: "Contact Us — ROW",
  description:
    "How to reach the ROW administration portal. Email, phone, postal address, support hours, and grievance officer.",
};

export default function ContactUsPage() {
  return (
    <PolicyPageLayout
      title="Contact Us"
      updated="Last updated: 5 June 2026"
      intro="We are here to help. Reach the ROW administration team through any of the channels below."
    >
      <section>
        <h2>Primary Contact</h2>
        <ul>
          <li>
            <strong>Operating entity:</strong> {MERCHANT.legalName}
          </li>
          <li>
            <strong>Email:</strong>{" "}
            <a href={`mailto:${MERCHANT.email}`}>{MERCHANT.email}</a>
          </li>
          <li>
            <strong>Help line:</strong>{" "}
            <a href={`tel:${MERCHANT.phone.replace(/[^+\d]/g, "")}`}>{MERCHANT.phone}</a>{" "}
            /{" "}
            <a href={`tel:${MERCHANT.phoneSecondary.replace(/[^+\d]/g, "")}`}>{MERCHANT.phoneSecondary}</a>
          </li>
          <li>
            <strong>Working hours:</strong> {MERCHANT.workingHours}
          </li>
        </ul>
      </section>

      <section>
        <h2>Registered Address</h2>
        <address style={{ fontStyle: "normal" }}>
          {MERCHANT.legalName}
          <br />
          {MERCHANT.address.line1}
          <br />
          {MERCHANT.address.line2}
          <br />
          PIN {MERCHANT.address.pin}
          <br />
          India
        </address>
      </section>

      <section>
        <h2>Support Categories</h2>
        <ul>
          <li>
            <strong>Account &amp; sign-in issues:</strong> mention your registered email or mobile number in the message.
          </li>
          <li>
            <strong>Payment &amp; refund requests:</strong> include the order reference / transaction ID from your payment receipt.
          </li>
          <li>
            <strong>Club / district administration:</strong> include club name, district number, and Rotary year.
          </li>
          <li>
            <strong>Technical bugs / data errors:</strong> a short description and a screenshot help us resolve faster.
          </li>
        </ul>
      </section>

      <section>
        <h2>Response Time</h2>
        <p>
          We aim to acknowledge every contact within <strong>two (2) business days</strong>{" "}
          and resolve standard issues within <strong>seven (7) business days</strong>. Time-sensitive payment
          disputes are prioritised.
        </p>
      </section>

      <section>
        <h2>Grievance Officer</h2>
        <p>
          In accordance with the Information Technology (Intermediary
          Guidelines and Digital Media Ethics Code) Rules, 2021 and the
          Digital Personal Data Protection Act, 2023, the Grievance Officer
          for this platform is:
        </p>
        <ul>
          <li>
            <strong>Name:</strong> The Designated Grievance Officer
          </li>
          <li>
            <strong>Email:</strong>{" "}
            <a href={`mailto:support@example.org`}>support@example.org</a>
          </li>
          <li>
            <strong>Address:</strong> Same as the registered address above.
          </li>
        </ul>
        <p>
          The Grievance Officer will acknowledge any grievance within{" "}
          <strong>twenty-four (24) hours</strong> and resolve it within{" "}
          <strong>fifteen (15) days</strong> of receipt, per Rule 3(2) of the
          said Rules.
        </p>
      </section>

      <section>
        <h2>Important Note on Payments</h2>
        <p>
          All payments on this platform are processed by <strong>Cashfree
          Payments India Pvt. Ltd.</strong> Refunds and chargebacks are governed by the{" "}
          <a href="/refunds-and-cancellations">Refunds &amp; Cancellations</a>{" "}
          policy. Disputes that cannot be resolved by writing to the above
          contacts may be escalated to Cashfree&apos;s grievance redressal
          channel as published on{" "}
          <a href="https://www.cashfree.com" target="_blank" rel="noopener noreferrer">
            cashfree.com
          </a>.
        </p>
      </section>
    </PolicyPageLayout>
  );
}

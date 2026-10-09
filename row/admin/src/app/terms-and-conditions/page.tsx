import type { Metadata } from "next";
import PolicyPageLayout from "@/components/public/PolicyPageLayout";
import { MERCHANT } from "@/lib/merchantInfo";

export const metadata: Metadata = {
  title: "Terms & Conditions — Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "Terms of use for the Rotary Zones 4, 5, 6, 7 & 8 administration portal — user obligations, payment terms, intellectual property, liability, governing law.",
};

export default function TermsPage() {
  return (
    <PolicyPageLayout
      title="Terms & Conditions"
      updated="Last updated: 5 June 2026"
      intro={`These Terms & Conditions ("Terms") govern your access to and use of the Rotary Zones 4, 5, 6, 7 & 8 administration portal hosted at rizones45678.org ("Platform"), operated by ${MERCHANT.legalName} ("we", "us", "our"). By accessing the Platform you agree to be bound by these Terms.`}
    >
      <section>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing, browsing, registering an account, signing in, or
          making a payment on the Platform, you confirm that you have read,
          understood, and agreed to be bound by these Terms together with our{" "}
          <a href="/privacy-policy">Privacy Policy</a> and{" "}
          <a href="/refunds-and-cancellations">Refunds &amp; Cancellations</a>{" "}
          policy. If you do not agree, please do not use the Platform.
        </p>
      </section>

      <section>
        <h2>2. Eligibility</h2>
        <p>
          The Platform is intended for use by members and office-bearers of
          Rotary clubs in Rotary International Districts that fall within
          Zones 4, 5, 6, 7 and 8 (as defined by Rotary International), authorised
          representatives of those districts, and persons making voluntary
          contributions to Rotary projects, events, or The Rotary Foundation.
        </p>
        <p>
          You must be at least eighteen (18) years of age and capable of
          forming a legally binding contract under Indian law to use the
          Platform or initiate any payment through it.
        </p>
      </section>

      <section>
        <h2>3. User Accounts &amp; Security</h2>
        <ul>
          <li>Accounts are created by your Club Secretary, District Administrator, or a duly authorised officer of the Platform; you may not self-register.</li>
          <li>You are responsible for keeping your credentials (mobile number / email, password, OTP) confidential and for every action taken under your account.</li>
          <li>You must immediately notify us at <a href={`mailto:${MERCHANT.email}`}>{MERCHANT.email}</a> if you suspect unauthorised access.</li>
          <li>We may suspend or terminate accounts that are inactive, compromised, or used in breach of these Terms.</li>
        </ul>
      </section>

      <section>
        <h2>4. Acceptable Use</h2>
        <p>You agree that you will not:</p>
        <ul>
          <li>Use the Platform for any unlawful, fraudulent, or unauthorised purpose;</li>
          <li>Attempt to gain unauthorised access to any portion of the Platform, its servers, or accounts of other users;</li>
          <li>Upload, transmit, or store content that is defamatory, obscene, infringing, or violates any applicable law;</li>
          <li>Interfere with or disrupt the integrity, security, or performance of the Platform;</li>
          <li>Use any automated means (scrapers, bots) to access the Platform without our prior written consent;</li>
          <li>Misrepresent your identity, affiliation with any club or district, or your authorisation to initiate payments.</li>
        </ul>
      </section>

      <section>
        <h2>5. Payments</h2>
        <h3>5.1 Currency &amp; Pricing</h3>
        <p>
          All payments on the Platform are denominated and processed in{" "}
          <strong>Indian Rupees (INR / ₹)</strong>. Exact amounts, applicable
          taxes, and the recipient (Rotary club, district, project, or The
          Rotary Foundation) are displayed on the payment confirmation screen
          before you authorise the transaction.
        </p>
        <h3>5.2 Payment Gateway</h3>
        <p>
          Payments are processed by <strong>Cashfree Payments India Pvt.
          Ltd.</strong> (a Reserve Bank of India authorised Payment
          Aggregator). By initiating a payment you agree to Cashfree&apos;s
          own terms of service. We do not store your full card number, CVV,
          or net-banking credentials on our servers.
        </p>
        <h3>5.3 Receipts</h3>
        <p>
          A receipt is emailed to your registered email address on successful
          payment. If you do not receive a receipt within thirty (30) minutes,
          please write to{" "}
          <a href={`mailto:${MERCHANT.email}`}>{MERCHANT.email}</a> with the
          order reference number shown on the Cashfree confirmation page.
        </p>
        <h3>5.4 Refunds</h3>
        <p>
          Refunds are governed by our{" "}
          <a href="/refunds-and-cancellations">Refunds &amp; Cancellations</a>{" "}
          policy. Please read it carefully before making a payment.
        </p>
      </section>

      <section>
        <h2>6. Intellectual Property</h2>
        <p>
          The Platform, including its software code, design, text, graphics,
          logos, and trademarks, is owned by or licensed to{" "}
          {MERCHANT.legalName}. &quot;Rotary&quot;, the Rotary wheel design,
          and related trademarks are the property of Rotary International and
          are used in accordance with the policies of Rotary International.
          Nothing in these Terms grants you any right or licence to use any
          such intellectual property other than as expressly permitted in
          writing.
        </p>
      </section>

      <section>
        <h2>7. User-Submitted Content</h2>
        <p>
          When you upload content (project photos, descriptions, member
          information, event details), you represent that you have the right
          to do so and grant us a non-exclusive, royalty-free licence to host,
          store, display, and distribute that content for the purpose of
          operating the Platform and fulfilling Rotary&apos;s administrative,
          reporting, and communication needs.
        </p>
      </section>

      <section>
        <h2>8. Third-Party Services</h2>
        <p>
          The Platform integrates with third-party services including (but not
          limited to) Cashfree Payments, email delivery services, SMS
          providers, and Rotary International&apos;s public APIs. Your use of
          those services is also subject to their respective terms.
        </p>
      </section>

      <section>
        <h2>9. Disclaimers</h2>
        <p>
          The Platform is provided on an &quot;as is&quot; and &quot;as
          available&quot; basis. To the maximum extent permitted by
          applicable law, we disclaim all warranties, express or implied,
          including any warranty of merchantability, fitness for a particular
          purpose, or non-infringement. We do not warrant that the Platform
          will be uninterrupted, error-free, secure against every threat, or
          that any data will be preserved indefinitely.
        </p>
      </section>

      <section>
        <h2>10. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, neither {MERCHANT.legalName}{" "}
          nor its officers, contractors, or partners shall be liable for any
          indirect, incidental, consequential, special, or punitive damages
          arising out of or in connection with your use of the Platform. Our
          aggregate liability for any direct loss arising from a single
          transaction shall not exceed the amount of that transaction.
        </p>
      </section>

      <section>
        <h2>11. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless {MERCHANT.legalName} from
          any claim, demand, loss, or expense (including reasonable legal
          fees) arising out of your breach of these Terms, your violation of
          any law, or your infringement of any third-party right.
        </p>
      </section>

      <section>
        <h2>12. Suspension &amp; Termination</h2>
        <p>
          We may suspend or terminate your account or access to the Platform
          at any time, with or without notice, if we reasonably believe you
          have breached these Terms or applicable law, or to protect the
          Platform&apos;s integrity. Termination does not relieve you of any
          outstanding payment obligations.
        </p>
      </section>

      <section>
        <h2>13. Governing Law &amp; Jurisdiction</h2>
        <p>
          These Terms are governed by the laws of the Republic of India.
          Subject to applicable consumer-protection legislation, the courts
          at Mumbai, Maharashtra shall have exclusive jurisdiction over any
          dispute arising out of or in connection with these Terms.
        </p>
      </section>

      <section>
        <h2>14. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. The &quot;Last
          updated&quot; date at the top reflects the most recent revision.
          Material changes will be communicated through the Platform or by
          email to registered users. Continued use of the Platform after the
          effective date of any change constitutes acceptance of the revised
          Terms.
        </p>
      </section>

      <section>
        <h2>15. Contact</h2>
        <p>
          Questions about these Terms? Write to us at{" "}
          <a href={`mailto:${MERCHANT.email}`}>{MERCHANT.email}</a> or visit{" "}
          our <a href="/contact-us">Contact Us</a> page.
        </p>
      </section>
    </PolicyPageLayout>
  );
}

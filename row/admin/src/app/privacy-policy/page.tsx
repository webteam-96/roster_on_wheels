import type { Metadata } from "next";
import PolicyPageLayout from "@/components/public/PolicyPageLayout";
import { MERCHANT } from "@/lib/merchantInfo";

export const metadata: Metadata = {
  title: "Privacy Policy — Rotary Zones 4, 5, 6, 7 & 8",
  description:
    "How the Rotary Zones 4, 5, 6, 7 & 8 administration portal collects, uses, shares, and protects your personal data. DPDPA 2023 compliant.",
};

export default function PrivacyPolicyPage() {
  return (
    <PolicyPageLayout
      title="Privacy Policy"
      updated="Last updated: 5 June 2026"
      intro={`This Privacy Policy explains how ${MERCHANT.legalName} ("we") collects, uses, discloses, retains, and protects personal data when you use the Rotary Zones 4, 5, 6, 7 & 8 administration portal ("Platform"). We comply with the Information Technology Act 2000, the Information Technology (Reasonable Security Practices) Rules 2011, the Digital Personal Data Protection Act 2023 ("DPDPA"), and any other applicable Indian data-protection legislation.`}
    >
      <section>
        <h2>1. Who We Are</h2>
        <p>
          The <strong>Data Fiduciary</strong> under the DPDPA, 2023 for the
          purposes of this Platform is {MERCHANT.legalName}. Our contact
          details are listed in the <a href="/contact-us">Contact Us</a> page
          and our Grievance Officer is identified there as well.
        </p>
      </section>

      <section>
        <h2>2. Personal Data We Collect</h2>
        <h3>2.1 You provide directly</h3>
        <ul>
          <li>Name, mobile number, email address, date of birth, gender;</li>
          <li>Postal address, city, state, PIN;</li>
          <li>Rotary identifiers — club name, club ID, district number, Rotary ID, designation, member type;</li>
          <li>Photographs of you (for the member directory and project documentation);</li>
          <li>Family-member details where you choose to add them.</li>
        </ul>
        <h3>2.2 Auto-collected from your interaction</h3>
        <ul>
          <li>Sign-in events (date, time, source IP, device user-agent);</li>
          <li>Audit log of administrative actions performed under your account;</li>
          <li>Cookies and similar technologies — strictly necessary cookies for session management.</li>
        </ul>
        <h3>2.3 Payment data</h3>
        <p>
          Payments are processed by <strong>Cashfree Payments India Pvt. Ltd.</strong>{" "}
          We do <strong>not</strong> store your full card number, CVV, UPI PIN, or
          net-banking password. We retain only the masked transaction
          metadata returned by Cashfree (order reference, payment method type,
          last 4 digits, amount, status) for reconciliation and receipt
          generation.
        </p>
      </section>

      <section>
        <h2>3. Lawful Basis &amp; Purpose</h2>
        <p>We process personal data only for one or more of the following purposes:</p>
        <ul>
          <li><strong>Account creation and authentication</strong> (consent / contract);</li>
          <li><strong>Service delivery</strong> — managing membership, projects, events, communications (contract);</li>
          <li><strong>Payment processing</strong> — collecting dues, registration fees, contributions (contract);</li>
          <li><strong>Statutory and Rotary International reporting</strong> — semi-annual reports, club annual returns (legal obligation);</li>
          <li><strong>Security &amp; fraud prevention</strong> — audit logs, abuse detection (legitimate interest);</li>
          <li><strong>Service improvement and support</strong> — aggregated analytics, troubleshooting (legitimate interest);</li>
          <li><strong>Communications</strong> from your club / district / RI about programmes, events, and reminders (consent / legitimate interest).</li>
        </ul>
      </section>

      <section>
        <h2>4. Sharing &amp; Disclosure</h2>
        <p>We share personal data only with:</p>
        <ul>
          <li>
            <strong>Your Rotary club and district officials</strong> — who require the data for legitimate Rotary administrative functions;
          </li>
          <li>
            <strong>Rotary International</strong> and its regional bodies — for statutory member-status reporting;
          </li>
          <li>
            <strong>Cashfree Payments India Pvt. Ltd.</strong> — payment gateway; subject to Cashfree&apos;s own privacy policy;
          </li>
          <li>
            <strong>Email and SMS service providers</strong> — strictly to deliver transactional and Rotary-related communications;
          </li>
          <li>
            <strong>Cloud hosting providers and managed-service partners</strong> — bound by confidentiality and security obligations under written contract;
          </li>
          <li>
            <strong>Law-enforcement and regulatory authorities</strong> — only when legally required.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> sell personal data to advertisers or
          unrelated third parties.
        </p>
      </section>

      <section>
        <h2>5. International Transfers</h2>
        <p>
          Personal data is hosted on servers in <strong>India</strong>. To the
          extent that any sub-processor (e.g., email service) processes data
          outside India, that processor is bound by data-protection
          obligations consistent with the DPDPA 2023.
        </p>
      </section>

      <section>
        <h2>6. Retention</h2>
        <ul>
          <li>
            <strong>Active accounts:</strong> for as long as the account is active and for one (1) year after the last login.
          </li>
          <li>
            <strong>Financial / transaction records:</strong> retained for{" "}
            <strong>eight (8) years</strong> after the financial year of the transaction,
            in keeping with the Income-Tax Act and statutory audit requirements.
          </li>
          <li>
            <strong>Audit logs:</strong> retained for three (3) years.
          </li>
          <li>
            <strong>Member directory data archived for Rotary historical record:</strong>{" "}
            retained indefinitely in an archived (non-active) state for institutional memory.
          </li>
        </ul>
      </section>

      <section>
        <h2>7. Your Rights (DPDPA 2023)</h2>
        <p>Subject to applicable law, you have the right to:</p>
        <ul>
          <li><strong>Access</strong> the personal data we hold about you;</li>
          <li><strong>Correct</strong> or update inaccurate or incomplete data;</li>
          <li><strong>Erase</strong> your data (subject to legal retention obligations);</li>
          <li><strong>Withdraw consent</strong> where processing is based on consent;</li>
          <li><strong>Grievance redressal</strong> through our Grievance Officer;</li>
          <li><strong>Nominate</strong> another individual to exercise your rights in the event of your incapacity or death.</li>
        </ul>
        <p>
          To exercise any right, write to{" "}
          <a href={`mailto:${MERCHANT.email}`}>{MERCHANT.email}</a> from your
          registered email address. We will respond within <strong>thirty
          (30) days</strong>.
        </p>
      </section>

      <section>
        <h2>8. Security</h2>
        <p>
          We implement reasonable security practices and procedures appropriate
          to the sensitivity of the data, including:
        </p>
        <ul>
          <li>HTTPS/TLS for all data in transit;</li>
          <li>Encryption of credentials at rest;</li>
          <li>Role-based access controls and the principle of least privilege;</li>
          <li>Audit logging of administrative actions;</li>
          <li>Regular backups and disaster-recovery procedures;</li>
          <li>Annual review of security controls.</li>
        </ul>
        <p>
          Despite these measures, no electronic transmission or storage is
          one-hundred-percent secure. You are responsible for protecting the
          confidentiality of your sign-in credentials.
        </p>
      </section>

      <section>
        <h2>9. Children&apos;s Data</h2>
        <p>
          The Platform is not intended for individuals under the age of
          eighteen (18). We do not knowingly collect personal data from
          children. Personal data of family members (including children)
          added by a Rotarian for the purpose of family records is treated as
          information of the Rotarian household and is processed under the
          consent of the registering Rotarian.
        </p>
      </section>

      <section>
        <h2>10. Cookies</h2>
        <p>
          We use only <strong>strictly necessary</strong> cookies and similar
          technologies (e.g., JSON Web Tokens stored in browser storage) for
          sign-in session continuity and security. We do not use third-party
          advertising or tracking cookies.
        </p>
      </section>

      <section>
        <h2>11. Changes to this Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Material
          changes will be communicated through the Platform or by email to
          registered users at least seven (7) days before they take effect.
          The &quot;Last updated&quot; date at the top reflects the most
          recent revision.
        </p>
      </section>

      <section>
        <h2>12. Grievances</h2>
        <p>
          For any grievance regarding the processing of your personal data,
          please write to our Grievance Officer at{" "}
          <a href="mailto:grievance@rizones45678.org">grievance@rizones45678.org</a>.
          See the <a href="/contact-us">Contact Us</a> page for full details.
        </p>
      </section>
    </PolicyPageLayout>
  );
}

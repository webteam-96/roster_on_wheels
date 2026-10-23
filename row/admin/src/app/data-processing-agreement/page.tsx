import type { Metadata } from "next";
import PolicyPageLayout from "@/components/public/PolicyPageLayout";
import { merchantFrom } from "@/lib/merchantInfo";
import { getServerBrand } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getServerBrand();
  return {
    title: `Data Processing Agreement (draft) | ${brand.productName}`,
    description: `Draft data processing agreement between a district or club and the operator of ${brand.productName}.`,
  };
}

/**
 * Draft DPA template (build spec 3.14), public, linked from Settings > Tenants and the policy footers. It describes
 * only what the platform does today; everything a lawyer or the operator must still decide is in [square brackets].
 * Keep Annex 2 and Annex 3 in step with the code: a new sub-processor or a removed safeguard changes this page.
 */
export default async function DataProcessingAgreementPage() {
  const brand = await getServerBrand();
  const MERCHANT = merchantFrom(brand);
  const processor = MERCHANT.legalName || "[Processor legal name]";
  const product = brand.productName;
  return (
    <PolicyPageLayout
      title="Data Processing Agreement"
      updated="Draft template, October 2026"
      intro={`A template agreement between a Rotary district or club that uses ${product} (the "Controller") and ${processor} (the "Processor"), which operates ${product}. It is a starting point for counsel, not a signed contract.`}
    >
      <div className="not-prose rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900" role="note">
        <p className="font-semibold">Draft, legal review required.</p>
        <p className="mt-1">
          This template is not in force and is not legal advice. Text in [square brackets] must be completed or confirmed
          before anyone signs it. It describes only what {product} does today.
        </p>
      </div>

      <section>
        <h2>1. Parties and roles</h2>
        <p>
          The Controller is the district or club named in the signature block. It decides why and how its members&apos;
          personal data is processed in {product}. The Processor is {processor}
          {MERCHANT.addressLines.length > 0 ? `, ${MERCHANT.addressLines.join(", ")}` : ", [address]"}. It runs the
          platform and processes that data only on the Controller&apos;s documented instructions, which are this agreement
          and the settings the Controller&apos;s administrators choose in the platform.
        </p>
      </section>

      <section>
        <h2>2. Subject matter, duration, nature and purpose</h2>
        <p>
          The Processor provides the {product} administration portal and mobile app for the Controller&apos;s clubs and
          members for the term of the Controller&apos;s subscription. Processing covers storing, organising, displaying,
          exporting and deleting the data described in Annex 1, and sending messages by email and in the app.
        </p>
      </section>

      <section>
        <h2>3. Obligations of the Processor</h2>
        <ul>
          <li>Process the personal data only on the Controller&apos;s documented instructions, including for transfers outside the Controller&apos;s country, unless the law requires otherwise; in that case it tells the Controller first where the law allows.</li>
          <li>Make sure that staff who can access the data are bound by confidentiality.</li>
          <li>Apply the technical and organisational measures in Annex 2.</li>
          <li>Help the Controller answer requests from data subjects; the platform lets district administrators export one member&apos;s full record and erase a member by anonymisation.</li>
          <li>Notify the Controller of a personal data breach without undue delay and in any case within [72] hours of becoming aware of it, with the information the Controller needs for its own notifications.</li>
          <li>Help the Controller with data protection impact assessments and consultations with a supervisory authority, where they concern the platform.</li>
          <li>At the end of the subscription, delete or return the Controller&apos;s personal data at the Controller&apos;s choice within [30] days, unless the law requires it to be kept.</li>
          <li>Make available the information needed to show compliance with this agreement and allow audits by the Controller or an auditor it appoints, [with reasonable notice and at the Controller&apos;s cost].</li>
        </ul>
      </section>

      <section>
        <h2>4. Sub-processors</h2>
        <p>
          The Controller gives general authorisation for the sub-processors in Annex 3. The Processor informs the
          Controller of an intended addition or replacement at least [30] days in advance, so the Controller can object.
          The Processor imposes the same data protection obligations on each sub-processor by contract and remains
          responsible for its performance.
        </p>
      </section>

      <section>
        <h2>5. International transfers and processing in India</h2>
        <p>
          The Processor&apos;s staff who build, run and support the platform work from India, and the data is hosted in
          [hosting provider and region, to be completed]. Where personal data is transferred to or accessed from a
          country without an adequacy decision for the Controller&apos;s country, the parties agree to these safeguards:
        </p>
        <ul>
          <li>
            <strong>European Union and EEA:</strong> the Standard Contractual Clauses adopted by Commission Implementing
            Decision (EU) 2021/914, Module Two (controller to processor), are incorporated by reference, with clause 7
            (docking clause) included, option 2 of clause 9(a) (general written authorisation, [30] days&apos; notice),
            the optional wording of clause 11 left out, clause 13 [competent supervisory authority], clause 17 the law of
            [EU Member State] and clause 18 the courts of [EU Member State]. Annexes I to III of the clauses are Annexes
            1 to 3 of this agreement.
          </li>
          <li>
            <strong>United Kingdom:</strong> the International Data Transfer Addendum to the EU Standard Contractual
            Clauses issued by the Information Commissioner (version B1.0), [Table 4 choice to be completed].
          </li>
          <li>
            <strong>Switzerland:</strong> the EU Standard Contractual Clauses as adapted for the Swiss Federal Act on Data
            Protection, with the Federal Data Protection and Information Commissioner as the supervisory authority.
          </li>
          <li>
            <strong>Canada and Australia:</strong> this agreement is the contractual means by which the Controller keeps
            the protection required by PIPEDA and Australian Privacy Principle 8 when the Processor handles the data.
          </li>
        </ul>
        <p>Where the clauses conflict with this agreement, the clauses prevail.</p>
      </section>

      <section>
        <h2>6. Liability, term and law</h2>
        <p>[Liability cap, term, termination and governing law outside the clauses: to be completed by counsel.]</p>
      </section>

      <section>
        <h2>Annex 1. Description of the processing</h2>
        <h3>Data subjects</h3>
        <ul>
          <li>Members and honorary members of the Controller&apos;s clubs, and district officers;</li>
          <li>family members a member chooses to add;</li>
          <li>contacts, prospects and guests the clubs record, speakers and volunteers.</li>
        </ul>
        <h3>Personal data</h3>
        <ul>
          <li>Name, email address, phone numbers, photo, date of birth, wedding anniversary, gender, postal address, preferred language;</li>
          <li>Rotary details: Rotary ID, club, designation, join and termination dates, Foundation recognitions;</li>
          <li>attendance, projects, events, goals and dues records;</li>
          <li>messages sent by email and in the app, with their delivery status, and the member&apos;s consent choices per channel;</li>
          <li>sign-in events and the audit log of administrative actions.</li>
        </ul>
        <p>Special categories of data: none are required by the platform. [The Controller confirms it does not enter any.]</p>
        <h3>Sources</h3>
        <p>
          Data entered by the Controller&apos;s administrators and members and, where the Controller enables it, member
          records imported from Rotary International for its clubs.
        </p>
        <h3>Retention</h3>
        <p>For the term of the subscription, then as in clause 3. [Retention periods within the term: to be completed.]</p>
      </section>

      <section>
        <h2>Annex 2. Technical and organisational measures</h2>
        <ul>
          <li>Access by role: club, district and platform administrators can read and change only the clubs and districts they manage; the server checks it.</li>
          <li>Passwords are stored as salted hashes (bcrypt), never in readable form.</li>
          <li>Administrative actions are written to an audit log.</li>
          <li>Export of one member&apos;s full record, and erasure of a member by anonymising their personal fields.</li>
          <li>With the communication module switched on: consent per channel is recorded, bulk emails carry an unsubscribe link, and addresses that bounce or complain are suppressed.</li>
          <li>[Encryption in transit: confirm HTTPS on every production address before signature.]</li>
          <li>[Backups: frequency, location and restore testing, to be completed.]</li>
          <li>[Monitoring and incident response: to be completed.]</li>
        </ul>
      </section>

      <section>
        <h2>Annex 3. Sub-processors</h2>
        <ul>
          <li><strong>Brevo, France:</strong> delivery of emails sent by the platform.</li>
          <li><strong>[Hosting provider], [region]:</strong> hosting of the application and its database.</li>
          <li>
            <strong>Machine translation service configured for the instance (default: MyMemory by Translated, Italy):</strong>{" "}
            when a user chooses a language without a reviewed translation, text shown on that screen is sent for
            translation; it can include personal data displayed there.
          </li>
        </ul>
        <p>
          Not used at launch, and added to this list before they are switched on: push notifications to the mobile app
          and online payments.
        </p>
      </section>

      <section>
        <h2>Signatures</h2>
        <p>Controller: [district or club name, signatory, title, date]. Processor: {processor}, [signatory, title, date].</p>
        {MERCHANT.privacyEmail && (
          <p>
            Questions about this template: <a href={`mailto:${MERCHANT.privacyEmail}`}>{MERCHANT.privacyEmail}</a>.
          </p>
        )}
      </section>
    </PolicyPageLayout>
  );
}

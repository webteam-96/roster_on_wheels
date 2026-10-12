import type { Metadata } from "next";
import PolicyPageLayout from "@/components/public/PolicyPageLayout";
import { MERCHANT } from "@/lib/merchantInfo";

export const metadata: Metadata = {
  title: "Refunds & Cancellations — ROW",
  description:
    "Refund and cancellation policy for Club Dues, event registrations, project contributions, and Foundation contributions on the ROW portal.",
};

export default function RefundsPage() {
  return (
    <PolicyPageLayout
      title="Refunds & Cancellations"
      updated="Last updated: 5 June 2026"
      intro="This policy explains how cancellations and refunds work across each kind of payment processed on the Platform. Read it carefully before making a payment."
    >
      <section>
        <h2>1. General Principles</h2>
        <ul>
          <li>
            Every payment screen clearly identifies <strong>who you are paying</strong>{" "}
            (your Rotary club, a district, a specific project, or The Rotary
            Foundation) and <strong>why</strong> (Club Dues, event registration,
            voluntary contribution).
          </li>
          <li>
            All amounts are charged and refunded in <strong>Indian Rupees (INR)</strong>.
          </li>
          <li>
            Refunds — when applicable — are issued to the <strong>original
            payment method</strong>. We do not offer cash, cheque, or alternate-account refunds.
          </li>
          <li>
            Cashfree&apos;s payment-gateway charges already deducted may not
            be reversible; the refund will be the net amount per Cashfree&apos;s policy.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. Club Dues</h2>
        <h3>2.1 Cancellation Window</h3>
        <p>
          A membership-dues payment can be cancelled only with the written
          consent of the recipient Rotary club&apos;s Secretary or Treasurer
          and only <strong>before the dues have been remitted to Rotary
          International / the District</strong>.
        </p>
        <h3>2.2 Refund Eligibility</h3>
        <p>
          Once dues are reported to RI / the District in the Club&apos;s
          semi-annual report (typically within seven (7) days of payment),
          the amount is no longer refundable through the Platform. Members
          who have over-paid or paid in error during this window should raise
          a request via the Club Secretary, who may seek adjustment in the
          next billing cycle.
        </p>
        <h3>2.3 Process</h3>
        <p>
          Write to{" "}
          <a href={`mailto:${MERCHANT.email}`}>{MERCHANT.email}</a> with your
          name, registered mobile number, the order reference, and a brief
          reason. Approved refunds are processed within{" "}
          <strong>five (5) to ten (10) business days</strong>.
        </p>
      </section>

      <section>
        <h2>3. Event Registration</h2>
        <h3>3.1 Set by the Organiser</h3>
        <p>
          Refund eligibility, cut-off dates, and any cancellation charges for
          event registration are determined by the <strong>organising Rotary
          club or District</strong> and disclosed on the event details page
          before you register.
        </p>
        <h3>3.2 Default Policy</h3>
        <p>If the organiser has not specified an event-specific policy:</p>
        <ul>
          <li>
            <strong>Cancelled by participant 15 or more days before the event:</strong>{" "}
            full refund of the registration fee, less Cashfree processing charges.
          </li>
          <li>
            <strong>Cancelled 7 to 14 days before the event:</strong> 50% of the
            registration fee, less Cashfree processing charges.
          </li>
          <li>
            <strong>Cancelled less than 7 days before the event, or no-show:</strong>{" "}
            no refund (organisers may have already committed expenses for venue, food, and materials).
          </li>
        </ul>
        <h3>3.3 Cancelled or Postponed by the Organiser</h3>
        <p>
          If the organiser cancels the event entirely, registered participants
          receive a <strong>full refund of the registration fee within fifteen
          (15) business days</strong>. If the event is postponed, your
          registration carries forward unless you specifically request a
          refund within seven (7) days of being notified of the new date.
        </p>
      </section>

      <section>
        <h2>4. Project &amp; Foundation Contributions</h2>
        <p>
          Voluntary contributions toward Rotary service projects, district
          initiatives, and <strong>The Rotary Foundation</strong> are{" "}
          <strong>treated as charitable donations</strong> and are{" "}
          <strong>generally non-refundable</strong>. We may, however,
          consider refund requests in any of the following circumstances:
        </p>
        <ul>
          <li><strong>Duplicate or accidental payment</strong> (proven through transaction logs).</li>
          <li><strong>Demonstrable technical error</strong> on the Platform leading to an unintended payment.</li>
          <li><strong>Fraudulent transaction</strong> reported promptly to your bank and to us.</li>
          <li><strong>Wrong recipient</strong> (e.g., the donor intended a different project) — refund subject to confirmation that funds have not been disbursed.</li>
        </ul>
        <p>
          Approved donor refunds are processed within{" "}
          <strong>ten (10) to fifteen (15) business days</strong>. Tax-receipts (e.g.
          80G) issued against the original donation will be revoked or
          amended as required.
        </p>
      </section>

      <section>
        <h2>5. Failed Transactions</h2>
        <p>
          If your card / UPI / net-banking was debited but the Platform did
          not record a successful payment, Cashfree will <strong>automatically
          reverse</strong> the amount within <strong>five (5) to seven (7) business
          days</strong>. No action is needed from your side. If the amount is
          not reversed within this period, please share the order reference
          and your bank statement with{" "}
          <a href={`mailto:${MERCHANT.email}`}>{MERCHANT.email}</a> so we can
          escalate to Cashfree.
        </p>
      </section>

      <section>
        <h2>6. How to Request a Refund</h2>
        <p>Email{" "}
          <a href={`mailto:${MERCHANT.email}`}>{MERCHANT.email}</a> with:
        </p>
        <ul>
          <li>Your full name and registered mobile / email;</li>
          <li>The Cashfree order reference number (e.g. <em>EVT20_…</em>) shown on the payment confirmation page or receipt;</li>
          <li>The amount and date of the payment;</li>
          <li>A brief reason for the refund request.</li>
        </ul>
        <p>
          We will acknowledge within <strong>two (2) business days</strong> and decide
          within <strong>seven (7) business days</strong>. Refunds approved are credited
          to the original payment method within an additional 5 – 15 business days,
          depending on the issuing bank.
        </p>
      </section>

      <section>
        <h2>7. Chargebacks</h2>
        <p>
          We encourage you to contact us first before initiating a chargeback
          with your bank — most issues can be resolved faster directly.
          Chargebacks raised for transactions found to be legitimate after
          investigation may lead to suspension of your Platform account.
        </p>
      </section>

      <section>
        <h2>8. Contact</h2>
        <p>
          Refund queries: <a href={`mailto:${MERCHANT.email}`}>{MERCHANT.email}</a>{" "}
          · Phone: <a href={`tel:${MERCHANT.phone.replace(/[^+\d]/g, "")}`}>{MERCHANT.phone}</a>{" "}
          · See full contact details on the <a href="/contact-us">Contact Us</a> page.
        </p>
      </section>
    </PolicyPageLayout>
  );
}

import type { Metadata } from "next";
import Legal from "@/components/Legal";
import { EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Refund and Cancellation Policy | Roster On Wheels",
  description: "How cancellations, refunds, event payments and late refunds work for Roster On Wheels (ROW).",
};

const mail = <a href={`mailto:${EMAIL}`}>{EMAIL}</a>;

// Kaizen Infotech's Refund Policy, adapted for ROW: the name, subscriptions in place of tickets and store items
export default function Page() {
  return (
    <Legal title="Refund Policy">
      <h2>Returns</h2>
      <p>
        Roster On Wheels (ROW) will not entertain any cancellation request or refund request after 48 hours of payment. If
        cancellation is done within this timeframe, we will refund the entire amount via the same source within 07 to 10
        working days. If the customer has paid twice for one transaction, the one transaction amount will be refunded via
        the same source within 07 to 10 working days. There are certain situations where only partial refunds are granted
        (if applicable).
      </p>

      <h2>Exchanges</h2>
      <p>
        Before paying for a subscription or registering for an event, carefully review your details. ROW will be unable to
        process exchanges after a payment has been made.
      </p>

      <h2>Delivery</h2>
      <p>ROW offers multiple delivery options. Currently, the following delivery options are available:</p>
      <ul>
        <li>Email confirmation: your payment confirmation and receipt will be sent via email.</li>
        <li>SMS notification.</li>
      </ul>

      <h2>Cancelled or postponed events</h2>
      <p>
        Occasionally, events or seminars are cancelled or postponed. Should this occur, we will attempt to contact you and
        refund the amount as per the policy of the organizer.
      </p>

      <h2>Customer care</h2>
      <p>
        If you need help regarding your payment or any other issue, we guarantee a response time of two working days, and
        you can contact us at {mail} to reach our customer service department.
      </p>

      <h2>Late or missing refunds (if applicable)</h2>
      <p>
        If you haven’t received a refund yet, first check your bank account again. Next, contact your bank. There is often
        some processing time before a refund is posted. If you’ve done all of this and you still have not received your
        refund, please contact us at {mail}.
      </p>

      <h2>Discounted subscriptions (if applicable)</h2>
      <p>Only regular priced subscriptions may be refunded; unfortunately, discounted or offer subscriptions cannot be refunded.</p>
    </Legal>
  );
}

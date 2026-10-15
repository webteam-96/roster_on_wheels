import type { Metadata } from "next";
import Link from "next/link";
import Legal from "@/components/Legal";
import { EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy | Roster On Wheels",
  description: "What Roster On Wheels (ROW) does with your information, how payments are kept secure, and how to contact us.",
};

const mail = <a href={`mailto:${EMAIL}`}>{EMAIL}</a>;

// Kaizen Infotech's Privacy Policy, adapted for ROW: the name, the website and app in place of a store
export default function Page() {
  return (
    <Legal title="Privacy Policy">
      <h2>Section 1: What do we do with your information?</h2>
      <p>
        When you subscribe to or pay through Roster On Wheels (ROW), as part of that process, we collect the personal
        information you give us such as your name, address, phone number and email address. When you use our website or
        app, we also automatically receive your device’s internet protocol (IP) address to provide us with information that
        helps us learn about your browser and operating system.
      </p>
      <p>Email marketing (if applicable): with your permission, we may send you emails about ROW, new features and other updates.</p>

      <h2>Section 2: Consent</h2>
      <p>
        When you provide us with personal information to complete a transaction, verify your credit card, pay club dues,
        or register for an event, we imply that you consent to our collecting it and using it for that specific reason
        only. If we ask for your personal information for a secondary reason, like marketing, we will either ask you
        directly for your expressed consent or provide you with an opportunity to say no.
      </p>
      <p>
        <strong>How can you withdraw your consent?</strong> If after you opt in, you change your mind, you may withdraw your
        consent for us to contact you, for the continued collection, use or disclosure of your information, at any time, by
        emailing us at {mail}.
      </p>

      <h2>Section 3: Disclosure</h2>
      <p>
        We may disclose your personal information if we are required by law to do so or if you violate our{" "}
        <Link href="/terms-of-service">Terms of Service</Link>.
      </p>

      <h2>Section 4: Payment</h2>
      <p>
        We use payment gateway platforms for processing payments. We do not store your card data on our servers. The data
        is encrypted through the Payment Card Industry Data Security Standard (PCI-DSS) when processing payment. Your
        purchase transaction data is only used as long as necessary to complete your purchase transaction. After that is
        complete, your purchase transaction information is not saved.
      </p>
      <p>
        Our payment gateway adheres to the standards set by PCI-DSS as managed by the PCI Security Standards Council, which
        is a joint effort of brands like Visa, MasterCard, American Express and Discover. PCI-DSS requirements help ensure
        the secure handling of credit card information by ROW and its service providers. For more insight, you may also
        want to read the terms and conditions of the payment gateway you pay through.
      </p>

      <h2>Section 5: Third-party services</h2>
      <p>
        In general, the third-party providers used by ROW will only collect, use and disclose your information to the extent
        necessary to allow them to perform the services they provide to us.
      </p>
      <p>
        However, certain third-party service providers, such as payment gateways and other payment transaction processors,
        have their own privacy policies in respect to the information we are required to provide to them for your
        purchase-related transactions. For these providers, we recommend that you read their privacy policies so you can
        understand the manner in which your personal information will be handled by these providers.
      </p>
      <p>
        In particular, remember that certain providers may be located in or have facilities that are located in a
        different jurisdiction than either you or us. So if you elect to proceed with a transaction that involves the
        services of a third-party service provider, then your information may become subject to the laws of the
        jurisdiction(s) in which that service provider or its facilities are located.
      </p>
      <p>
        Once you leave our website or app, or are redirected to a third-party website or application, you are no longer
        governed by this Privacy Policy or our Terms of Service.
      </p>

      <h2>Links</h2>
      <p>
        When you click on links on our website or app, they may direct you away from our site. We are not responsible for
        the privacy practices of other sites and encourage you to read their privacy statements.
      </p>

      <h2>Section 6: Security</h2>
      <p>
        To protect your personal information, we take reasonable precautions and follow industry best practices to make
        sure it is not inappropriately lost, misused, accessed, disclosed, altered or destroyed.
      </p>

      <h2>Section 7: Cookies</h2>
      <p>We use cookies to maintain the session of your user. It is not used to personally identify you on other websites.</p>

      <h2>Section 8: Age of consent</h2>
      <p>
        By using this site, you represent that you are at least the age of majority in your state or province of
        residence, or that you are the age of majority in your state or province of residence and you have given us your
        consent to allow any of your minor dependents to use this site.
      </p>

      <h2>Section 9: Changes to this privacy policy</h2>
      <p>
        We reserve the right to modify this privacy policy at any time, so please review it frequently. Changes and
        clarifications will take effect immediately upon their posting on the website. If we make material changes to this
        policy, we will notify you here that it has been updated, so that you are aware of what information we collect, how
        we use it, and under what circumstances, if any, we use and/or disclose it.
      </p>
      <p>
        If ROW is acquired or merged with another company, your information may be transferred to the new owners so that we
        may continue to provide our services to you.
      </p>

      <h2>Questions and contact information</h2>
      <p>
        If you would like to access, correct, amend or delete any personal information we have about you, register a
        complaint, or simply want more information, contact us at {mail}.
      </p>
    </Legal>
  );
}

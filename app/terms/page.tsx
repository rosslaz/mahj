import { LEGAL_VERSIONS, LEGAL_DATES } from '@/lib/legal-docs';
import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service · Pungctual',
};

export default function TermsPage() {
  return (
    <article className="prose-legal max-w-3xl mx-auto py-6 space-y-6">
      <header className="border-b border-ink/15 pb-6 mb-6">
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">Legal</p>
        <h1 className="font-display text-5xl">Terms of Service</h1>
        <p className="text-sm text-ink/50 mt-3 italic">
          Version {LEGAL_VERSIONS.terms} · Effective {LEGAL_DATES.terms}
        </p>
      </header>

      <section className="bg-cinnabar/5 border border-cinnabar/30 p-5 text-sm space-y-2">
        <p className="font-semibold">Please read carefully.</p>
        <p className="text-ink/70">
          By creating an account or using Pungctual, you agree to these Terms of Service. If you do not agree, do not use the service. These Terms include important provisions about liability, dispute resolution, and limits on your rights — please review them in full.
        </p>
      </section>

      <h2 className="font-display text-2xl mt-8">1. Who we are</h2>
      <p>
        Pungctual is operated by Lazer Logic LLC, a Michigan limited liability company ("Pungctual," "we," "us," or "our"). These Terms of Service ("Terms") govern your access to and use of the Pungctual website, mobile applications, and any related services (collectively, the "Service").
      </p>

      <h2 className="font-display text-2xl mt-8">2. Eligibility</h2>
      <p>
        To create an account, you must be at least 13 years old. If you are under 18, you may only use the Service with the permission of a parent or legal guardian. By creating an account, if you are under 18, you confirm that a parent or legal guardian has read these Terms and consents to your use of the Service.
      </p>
      <p>
        We do not knowingly collect information from or provide services to anyone under 13. If we become aware that we have collected information from someone under 13 without verified parental consent, we will delete that information.
      </p>
      <p>
        You may only create one account per person. You may not create an account using another person&apos;s identity, on behalf of someone else without their authorization, or as a corporate or automated agent (except where we explicitly authorize it).
      </p>

      <h2 className="font-display text-2xl mt-8">3. Your account</h2>
      <p>
        You are responsible for maintaining the security of your account, including the email address used to sign in. You must notify us promptly if you believe your account has been compromised. We use passwordless sign-in via email; whoever has access to your email can access your account.
      </p>
      <p>
        You are responsible for all activity that occurs through your account. We are not liable for any loss or damage arising from unauthorized use of your account.
      </p>
      <p>
        You may close your account at any time by contacting us. We may suspend or terminate your account if we believe you have violated these Terms, the Acceptable Use Policy, or applicable law, or if we discontinue the Service.
      </p>

      <h2 className="font-display text-2xl mt-8">4. Using the Service</h2>
      <p>
        Pungctual helps clubs organize mahjong events, manage member rosters, and track game results. You may use the Service to:
      </p>
      <ul className="list-disc list-inside space-y-1">
        <li>Create or join clubs, and participate in events those clubs host</li>
        <li>Provide your name, email, and event location information</li>
        <li>Communicate with other members of clubs you join</li>
      </ul>
      <p>
        Your use of the Service is also subject to our <Link href="/acceptable-use" className="text-jade underline">Acceptable Use Policy</Link>, which is incorporated into these Terms by reference. Violating the Acceptable Use Policy violates these Terms.
      </p>

      <h2 className="font-display text-2xl mt-8">5. Real-world events and meetings</h2>
      <p>
        Pungctual is a tool for organizing events; we do not host, attend, or supervise the events themselves. You attend any in-person event organized through the Service at your own risk. You are solely responsible for evaluating whether to attend an event, who you interact with, and how you behave at events.
      </p>
      <p>
        We do not perform background checks on users. We do not verify the identity, intentions, suitability, or safety of any user. We do not endorse, control, or assume any responsibility for the conduct of any user, the safety or accessibility of any venue, or the lawfulness of any event activity.
      </p>
      <p>
        If you choose to host an event, you are responsible for the lawfulness, safety, and conduct of that event, including compliance with property rules, applicable laws, and any duty of care to attendees. If you choose to attend an event, you assume the risks inherent in meeting other people and being present at a venue.
      </p>

      <h2 className="font-display text-2xl mt-8">6. Data accuracy</h2>
      <p>
        Information displayed in the Service — including event dates, times, addresses, attendee lists, game results, statistics, and any other content — is provided by users and the Service on a best-efforts basis. We do not guarantee that any information is accurate, complete, or current.
      </p>
      <p>
        You should confirm important details (location, time, etc.) with the event host before relying on them. We are not responsible for any loss, missed event, wasted travel, or other harm resulting from inaccurate or out-of-date information displayed through the Service.
      </p>

      <h2 className="font-display text-2xl mt-8">7. No real-money play</h2>
      <p>
        The Service is provided for organizing recreational mahjong play. The Service does not facilitate, process, or track wagers, stakes, payments between players, gambling, or any exchange of real money or items of monetary value between users.
      </p>
      <p>
        You may not use the Service to organize, advertise, coordinate, settle, or in any way facilitate gambling or wagering activity. If users at an event you organize choose to play for stakes, you do so outside the Service and at your own risk and responsibility, including for any legal consequences. We disclaim any involvement in or responsibility for such activity.
      </p>

      <h2 className="font-display text-2xl mt-8">8. Content you provide</h2>
      <p>
        You retain ownership of the content you provide through the Service (your name, profile information, event details, etc.). By providing content, you grant us a non-exclusive, royalty-free, worldwide license to host, store, reproduce, display, and distribute that content as necessary to operate, improve, and provide the Service.
      </p>
      <p>
        You represent that you have the right to provide any content you submit and that it does not violate the rights of any third party.
      </p>
      <p>
        We may remove content that violates these Terms, the Acceptable Use Policy, or applicable law, with or without notice.
      </p>

      <h2 className="font-display text-2xl mt-8">9. Privacy</h2>
      <p>
        Our handling of personal information is described in our <Link href="/privacy" className="text-jade underline">Privacy Policy</Link>. By using the Service, you acknowledge that you have read and understood the Privacy Policy.
      </p>

      <h2 className="font-display text-2xl mt-8">10. Plans, billing, and subscriptions</h2>
      <p>
        Pungctual offers a free tier and a paid per-club subscription (&quot;Pro&quot;). Current pricing is shown in the Service; at the time of writing, Pro is US$9 per month or US$90 per year, per club. Prices are in U.S. dollars and, unless stated otherwise, exclusive of any applicable taxes, which are your responsibility.
      </p>
      <p>
        <strong>Trials.</strong> New clubs may be offered a free Pro trial (currently 14 days, or longer during promotional periods). Each person receives at most one trial, applied to the first club they create; additional clubs start on the free tier. No payment method is required for a trial. If a trial ends without a subscription, the club moves to the free tier.
      </p>
      <p>
        <strong>Payment processing.</strong> Payments are processed by Stripe, Inc. We never see or store your card details. By subscribing, you authorize recurring charges to your payment method and agree to any Stripe terms that apply to the payment.
      </p>
      <p>
        <strong>Automatic renewal and cancellation.</strong> Subscriptions renew automatically at the end of each billing period (monthly or annual) until canceled. You can cancel at any time from your club&apos;s billing page; cancellation takes effect at the end of the current billing period, and the club keeps Pro access through the period already paid.
      </p>
      <p>
        <strong>Refunds.</strong> Except where required by law, payments are non-refundable, and we do not provide refunds or credits for partial billing periods, downgrades, or unused time. Deleting a club cancels its subscription immediately, without a refund for the remainder of the period. Transferring club ownership sets the existing subscription to cancel at the end of the paid period — the departing owner is not charged again, the club keeps Pro through that period, and the new owner may start their own subscription.
      </p>
      <p>
        <strong>Failed payments and downgrades.</strong> If a renewal payment fails, Stripe retries it over several days and Pro access continues during that grace period; if payment cannot be completed, the club moves to the free tier. Moving to the free tier does not delete anything — existing members, activities, and history remain — but actions beyond the free tier&apos;s limits (such as adding members, activities, or admins beyond the free caps, creating hidden events, or sending email invitations) are unavailable unless the club is upgraded again.
      </p>
      <p>
        <strong>Price changes.</strong> We may change subscription pricing. Price changes take effect no earlier than your next renewal after we provide notice (through the Service or by email). If you do not agree to a price change, cancel before it takes effect.
      </p>

      <h2 className="font-display text-2xl mt-8">11. Changes to the Service</h2>
      <p>
        We may modify, suspend, or discontinue the Service or any part of it at any time, with or without notice. We are not liable to you or any third party for any modification, suspension, or discontinuation of the Service.
      </p>
      <p>
        We may update these Terms from time to time. When we make material changes, we will notify you through the Service (for example, by requiring you to re-accept the updated Terms before continued use). Continued use of the Service after a material change constitutes acceptance of the updated Terms.
      </p>

      <h2 className="font-display text-2xl mt-8">12. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR FREE OF VIRUSES OR OTHER HARMFUL COMPONENTS.
      </p>
      <p>
        Some jurisdictions do not allow the disclaimer of certain warranties. In those jurisdictions, the above disclaimers apply to the maximum extent permitted by law.
      </p>

      <h2 className="font-display text-2xl mt-8">13. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER LAZER LOGIC LLC, ITS OFFICERS, EMPLOYEES, AGENTS, NOR AFFILIATES SHALL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
      </p>
      <p>
        OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (a) THE AMOUNTS YOU HAVE PAID US FOR THE SERVICE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR (b) ONE HUNDRED U.S. DOLLARS (US$100).
      </p>
      <p>
        Some jurisdictions do not allow the limitation of incidental or consequential damages. In those jurisdictions, our liability is limited to the maximum extent permitted by law.
      </p>

      <h2 className="font-display text-2xl mt-8">14. Indemnification</h2>
      <p>
        You agree to indemnify and hold Lazer Logic LLC, its officers, employees, agents, and affiliates harmless from any claims, liabilities, damages, losses, and expenses (including reasonable attorneys&apos; fees) arising out of or in any way connected with: (i) your use of the Service; (ii) your violation of these Terms or the Acceptable Use Policy; (iii) your violation of any rights of another party; or (iv) your participation in any in-person event organized through the Service.
      </p>

      <h2 className="font-display text-2xl mt-8">15. Governing law and dispute resolution</h2>
      <p>
        These Terms are governed by the laws of the State of Michigan, without regard to its conflict of laws principles. Any disputes arising out of or relating to these Terms or the Service shall be brought exclusively in the state or federal courts located in Oakland County, Michigan, and you consent to the personal jurisdiction of those courts.
      </p>
      <p>
        Each party irrevocably waives any right to a trial by jury for any dispute arising under or relating to these Terms.
      </p>

      <h2 className="font-display text-2xl mt-8">16. Users outside the United States</h2>
      <p>
        The Service is operated from the United States. If you access the Service from outside the United States, you do so on your own initiative and are responsible for compliance with local laws. You consent to the transfer and processing of your information in the United States, which may have data protection laws different from those of your jurisdiction.
      </p>

      <h2 className="font-display text-2xl mt-8">17. General provisions</h2>
      <p>
        These Terms, together with the Privacy Policy and Acceptable Use Policy, are the entire agreement between you and us regarding the Service. If any provision of these Terms is found to be unenforceable, the remaining provisions will continue in full force and effect.
      </p>
      <p>
        Our failure to enforce any right or provision of these Terms is not a waiver of that right or provision. You may not assign these Terms; we may assign them in connection with a merger, acquisition, or sale of assets.
      </p>

      <h2 className="font-display text-2xl mt-8">18. Contact</h2>
      <p>
        Questions about these Terms? Contact us at <a href="mailto:support@pungctual.com" className="text-jade underline">support@pungctual.com</a>.
      </p>

      <p className="text-xs text-ink/40 italic pt-10 mt-10 border-t border-ink/10">
        These Terms of Service have not yet been reviewed by legal counsel and may be updated. By using the Service you agree to these Terms in their current form; if they are revised, you will be asked to re-accept the updated version.
      </p>
    </article>
  );
}

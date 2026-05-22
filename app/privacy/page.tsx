import { LEGAL_VERSIONS, LEGAL_DATES } from '@/lib/legal-docs';
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy · Pungctual',
};

export default function PrivacyPage() {
  return (
    <article className="prose-legal max-w-3xl mx-auto py-6 space-y-6">
      <header className="border-b border-ink/15 pb-6 mb-6">
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">Legal</p>
        <h1 className="font-display text-5xl">Privacy Policy</h1>
        <p className="text-sm text-ink/50 mt-3 italic">
          Version {LEGAL_VERSIONS.privacy} · Effective {LEGAL_DATES.privacy}
        </p>
      </header>

      <p>
        This Privacy Policy explains what information Lazer Logic LLC ("Pungctual," "we," "us," or "our") collects when you use the Pungctual website, mobile applications, and related services (the "Service"), how we use that information, and the choices you have about it.
      </p>
      <p>
        By using the Service, you acknowledge that you have read this Privacy Policy.
      </p>

      <h2 className="font-display text-2xl mt-8">1. Who we are</h2>
      <p>
        Lazer Logic LLC, a Michigan limited liability company, is the controller of personal information processed through the Service. You can contact us about privacy matters at <a href="mailto:privacy@pungctual.com" className="text-jade underline">privacy@pungctual.com</a>.
      </p>

      <h2 className="font-display text-2xl mt-8">2. Information we collect</h2>
      <p>We collect the following categories of information:</p>

      <h3 className="font-display text-xl mt-4">Information you provide</h3>
      <ul className="list-disc list-inside space-y-1">
        <li><strong>Account information</strong>: your email address, name, and any optional profile details (such as phone number, mailing address).</li>
        <li><strong>Club and event information</strong>: club names, event dates, locations (including street addresses for events you host or attend), and other details you enter.</li>
        <li><strong>Game results</strong>: scores, wins, and statistics you record through the Service.</li>
        <li><strong>Notification preferences</strong>: your choices about push notifications and which devices receive them.</li>
        <li><strong>Communications</strong>: messages you send to us, such as support inquiries.</li>
      </ul>

      <h3 className="font-display text-xl mt-4">Information collected automatically</h3>
      <ul className="list-disc list-inside space-y-1">
        <li><strong>Device and browser information</strong>: such as IP address, user agent, operating system, and approximate location based on IP.</li>
        <li><strong>Usage data</strong>: pages visited, features used, timestamps, and errors encountered.</li>
        <li><strong>Cookies and similar technologies</strong>: see Section 6 below.</li>
      </ul>

      <h3 className="font-display text-xl mt-4">Information from third parties</h3>
      <p>
        If you sign in using a third-party authentication provider (such as Google), we receive your email address and basic profile information from that provider.
      </p>

      <h2 className="font-display text-2xl mt-8">3. How we use information</h2>
      <p>We use the information we collect to:</p>
      <ul className="list-disc list-inside space-y-1">
        <li>Provide, maintain, and improve the Service</li>
        <li>Authenticate you and keep your account secure</li>
        <li>Send transactional emails (sign-in links, event reminders, calendar invites, and similar)</li>
        <li>Send push notifications you have opted in to</li>
        <li>Communicate with you about the Service, including updates and changes to these policies</li>
        <li>Detect, investigate, and prevent fraud, abuse, and security incidents</li>
        <li>Comply with legal obligations</li>
      </ul>

      <p>For users in the European Economic Area (EEA) and United Kingdom, our legal bases for processing are:</p>
      <ul className="list-disc list-inside space-y-1">
        <li><strong>Contract</strong>: processing necessary to provide the Service you have requested</li>
        <li><strong>Legitimate interests</strong>: improving and securing the Service, preventing abuse</li>
        <li><strong>Consent</strong>: where you have opted in (for example, to push notifications)</li>
        <li><strong>Legal obligation</strong>: where applicable law requires processing</li>
      </ul>

      <h2 className="font-display text-2xl mt-8">4. How we share information</h2>
      <p>We do not sell your personal information. We share information only in these limited circumstances:</p>

      <h3 className="font-display text-xl mt-4">With other users</h3>
      <p>
        Other members of clubs and events you participate in can see your name, basic profile details, your participation in events, and your game results. Event addresses are visible to approved attendees of those events. Email addresses, phone numbers, and home addresses are not displayed to other users unless you choose to enter them in places visible to others.
      </p>

      <h3 className="font-display text-xl mt-4">With service providers</h3>
      <p>
        We use trusted third parties to operate the Service. They access information only to perform tasks on our behalf and are contractually obligated to protect it. These include:
      </p>
      <ul className="list-disc list-inside space-y-1">
        <li><strong>Supabase, Inc.</strong> — database hosting and authentication</li>
        <li><strong>Vercel Inc.</strong> — application hosting</li>
        <li><strong>Resend, Inc.</strong> — transactional email delivery</li>
        <li><strong>Functional Software, Inc. (Sentry)</strong> — error monitoring</li>
        <li><strong>Google LLC</strong> — push notification delivery (Android), email delivery infrastructure</li>
        <li><strong>Apple Inc.</strong> — push notification delivery (iOS)</li>
      </ul>

      <h3 className="font-display text-xl mt-4">For legal reasons</h3>
      <p>
        We may disclose information if required by law, subpoena, or other legal process, or if we believe in good faith that disclosure is necessary to (a) comply with legal obligations, (b) protect our rights or property, (c) prevent fraud or abuse, or (d) protect the safety of users or the public.
      </p>

      <h3 className="font-display text-xl mt-4">In a business transfer</h3>
      <p>
        If Lazer Logic LLC is involved in a merger, acquisition, or sale of assets, your information may be transferred. We will notify you (for example, by email or prominent notice in the Service) before your information is transferred to a new entity.
      </p>

      <h2 className="font-display text-2xl mt-8">5. Where we store information</h2>
      <p>
        Information is stored on servers operated by Supabase and Vercel, primarily located in the United States. If you are accessing the Service from outside the United States, your information will be transferred to and processed in the United States, which may have data protection laws different from those of your jurisdiction.
      </p>
      <p>
        For transfers from the EEA, United Kingdom, or Switzerland, we rely on Standard Contractual Clauses or other lawful transfer mechanisms.
      </p>

      <h2 className="font-display text-2xl mt-8">6. Cookies and tracking</h2>
      <p>
        We use cookies and similar technologies for essential purposes only:
      </p>
      <ul className="list-disc list-inside space-y-1">
        <li><strong>Authentication cookies</strong> set by Supabase — these keep you signed in and are required for the Service to function</li>
      </ul>
      <p>
        We do not use cookies for advertising, third-party analytics, or cross-site tracking. We do not honor Do Not Track signals because we do not collect the kind of cross-site information those signals are designed to prevent.
      </p>

      <h2 className="font-display text-2xl mt-8">7. Your rights</h2>

      <h3 className="font-display text-xl mt-4">Access, correction, and deletion</h3>
      <p>
        You can view and update most of your account information through your profile page. To request a copy of all information we hold about you, or to request deletion of your account and associated data, email <a href="mailto:privacy@pungctual.com" className="text-jade underline">privacy@pungctual.com</a>. We will respond within 30 days, or sooner if required by law.
      </p>
      <p>
        We may retain some information after account deletion where required by law or for legitimate business purposes such as fraud prevention. We will delete or anonymize such information as soon as those purposes are satisfied.
      </p>

      <h3 className="font-display text-xl mt-4">EEA and UK residents</h3>
      <p>You have the right to:</p>
      <ul className="list-disc list-inside space-y-1">
        <li>Access the personal information we hold about you</li>
        <li>Correct inaccurate or incomplete information</li>
        <li>Request deletion of your personal information</li>
        <li>Restrict or object to certain processing</li>
        <li>Receive a portable copy of your information</li>
        <li>Withdraw consent at any time (without affecting the lawfulness of processing before withdrawal)</li>
        <li>Lodge a complaint with your local data protection authority</li>
      </ul>

      <h3 className="font-display text-xl mt-4">California residents</h3>
      <p>
        Under the California Consumer Privacy Act ("CCPA"), California residents have rights to know, delete, and opt out of the &quot;sale&quot; or &quot;sharing&quot; of their personal information. We do not sell or share personal information for cross-context behavioral advertising, so there is no opt-out toggle to display. You may exercise your access and deletion rights as described above.
      </p>

      <h2 className="font-display text-2xl mt-8">8. Children</h2>
      <p>
        The Service is not intended for children under 13. We do not knowingly collect information from anyone under 13. If we learn we have collected information from someone under 13 without verified parental consent, we will delete that information.
      </p>
      <p>
        For users between 13 and 17, we require self-attestation that a parent or legal guardian has consented to your use of the Service. If you are a parent or guardian and believe your child has provided us with information without your consent, please contact us at <a href="mailto:privacy@pungctual.com" className="text-jade underline">privacy@pungctual.com</a>.
      </p>

      <h2 className="font-display text-2xl mt-8">9. Data retention</h2>
      <p>
        We retain your account information for as long as your account is active. If you delete your account, we delete or anonymize your personal information within 90 days, except where retention is required by law or for legitimate business purposes (such as resolving disputes, enforcing our agreements, or preventing fraud).
      </p>
      <p>
        Aggregated or anonymized information that cannot reasonably be linked back to you may be retained indefinitely.
      </p>

      <h2 className="font-display text-2xl mt-8">10. Security</h2>
      <p>
        We use commercially reasonable measures to protect your information, including encryption in transit (HTTPS), access controls, and the security practices of our service providers. No system is perfectly secure, however, and we cannot guarantee the security of your information.
      </p>
      <p>
        If we become aware of a security incident affecting your information, we will notify you in accordance with applicable law.
      </p>

      <h2 className="font-display text-2xl mt-8">11. Future paid features</h2>
      <p>
        The Service is currently free. If we introduce paid features in the future, we may collect billing information (such as payment card details) through a payment processor. We will update this Privacy Policy at that time to describe how billing information is handled.
      </p>

      <h2 className="font-display text-2xl mt-8">12. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we make material changes, we will notify you through the Service (for example, by requiring you to re-acknowledge the updated Policy) and update the &quot;Effective&quot; date above. We encourage you to review this Policy periodically.
      </p>

      <h2 className="font-display text-2xl mt-8">13. Contact</h2>
      <p>
        Privacy questions, requests, or complaints? Contact us at <a href="mailto:privacy@pungctual.com" className="text-jade underline">privacy@pungctual.com</a>.
      </p>

      <p className="text-xs text-ink/40 italic pt-10 mt-10 border-t border-ink/10">
        This Privacy Policy has not yet been reviewed by legal counsel and may be updated. By using the Service you acknowledge this Policy in its current form; if it is revised, you will be asked to re-acknowledge the updated version.
      </p>
    </article>
  );
}

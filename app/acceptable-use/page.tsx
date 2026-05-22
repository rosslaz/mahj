import { LEGAL_VERSIONS, LEGAL_DATES } from '@/lib/legal-docs';
import Link from 'next/link';

export const metadata = {
  title: 'Acceptable Use Policy · Pungctual',
};

export default function AcceptableUsePage() {
  return (
    <article className="prose-legal max-w-3xl mx-auto py-6 space-y-6">
      <header className="border-b border-ink/15 pb-6 mb-6">
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">Legal</p>
        <h1 className="font-display text-5xl">Acceptable Use Policy</h1>
        <p className="text-sm text-ink/50 mt-3 italic">
          Version {LEGAL_VERSIONS.acceptable_use} · Effective {LEGAL_DATES.acceptable_use}
        </p>
      </header>

      <p>
        This Acceptable Use Policy ("AUP") sets out the rules for using Pungctual. It is part of the <Link href="/terms" className="text-jade underline">Terms of Service</Link>. Violating this AUP is a violation of the Terms of Service and may result in suspension or termination of your account.
      </p>

      <h2 className="font-display text-2xl mt-8">Prohibited content</h2>
      <p>You may not post, share, or upload through the Service any content that:</p>
      <ul className="list-disc list-inside space-y-1">
        <li>Is unlawful, deceptive, defamatory, fraudulent, or violates anyone&apos;s rights (including intellectual property, privacy, or publicity rights)</li>
        <li>Harasses, threatens, intimidates, stalks, or incites violence against any person or group</li>
        <li>Promotes hatred or discrimination on the basis of race, ethnicity, national origin, religion, gender, gender identity, sexual orientation, disability, age, or any other protected characteristic</li>
        <li>Is sexually explicit, depicts or sexualizes minors, or is otherwise inappropriate for a general audience</li>
        <li>Contains malicious code, viruses, or links to malicious sites</li>
        <li>Impersonates another person or misrepresents your identity or affiliation</li>
        <li>Reveals another person&apos;s private information (such as home address, phone number, or email) without their consent</li>
      </ul>

      <h2 className="font-display text-2xl mt-8">Prohibited conduct</h2>
      <p>You may not use the Service to:</p>
      <ul className="list-disc list-inside space-y-1">
        <li>Organize, advertise, or facilitate gambling, wagering, or any exchange of money or items of monetary value between users</li>
        <li>Solicit, recruit, or attempt to develop romantic or sexual relationships with minors</li>
        <li>Send unsolicited promotional messages, spam, or chain communications</li>
        <li>Attempt to gain unauthorized access to the Service, other users&apos; accounts, or any related systems</li>
        <li>Probe, scan, or test the vulnerability of the Service without prior written authorization from us</li>
        <li>Interfere with or disrupt the Service or the servers and networks connected to it</li>
        <li>Use automated means (bots, scrapers, crawlers) to access the Service, except for publicly accessible search engine crawlers</li>
        <li>Reverse engineer, decompile, or attempt to extract the source code of the Service, except where this is expressly permitted by applicable law</li>
        <li>Collect or harvest personal information of other users</li>
        <li>Resell, rent, or otherwise commercially exploit access to the Service without our written permission</li>
        <li>Use the Service to violate any applicable law, regulation, or third-party agreement</li>
      </ul>

      <h2 className="font-display text-2xl mt-8">Real-world conduct at events</h2>
      <p>
        Pungctual is a tool for organizing events, but conduct at those events is the responsibility of the participants and the host. We expect all users to behave lawfully and respectfully at events organized through the Service.
      </p>
      <p>
        If you experience or witness illegal conduct, harassment, threats, or other serious misconduct at an event, we encourage you to report it to local authorities. You may also report serious incidents to us at <a href="mailto:support@pungctual.com" className="text-jade underline">support@pungctual.com</a>. We may take action on accounts involved in such conduct, including suspension or termination.
      </p>

      <h2 className="font-display text-2xl mt-8">Reporting violations</h2>
      <p>
        If you believe a user is violating this AUP, please contact us at <a href="mailto:support@pungctual.com" className="text-jade underline">support@pungctual.com</a> with details. We review reports and take appropriate action, which may include warning the user, removing content, restricting account features, or terminating the account.
      </p>

      <h2 className="font-display text-2xl mt-8">Enforcement</h2>
      <p>
        We may, in our sole discretion, investigate suspected violations of this AUP. We may take any of the following actions when we believe a violation has occurred:
      </p>
      <ul className="list-disc list-inside space-y-1">
        <li>Remove or restrict access to content</li>
        <li>Issue a warning</li>
        <li>Suspend or terminate access to the Service</li>
        <li>Refer the matter to law enforcement</li>
      </ul>
      <p>
        We are not required to take any particular action in response to a reported violation. Our decision not to act in any particular case does not waive our right to act in other cases.
      </p>

      <h2 className="font-display text-2xl mt-8">Contact</h2>
      <p>
        Questions about this Acceptable Use Policy? Contact us at <a href="mailto:support@pungctual.com" className="text-jade underline">support@pungctual.com</a>.
      </p>

      <p className="text-xs text-ink/40 italic pt-10 mt-10 border-t border-ink/10">
        This Acceptable Use Policy has not yet been reviewed by legal counsel and may be updated.
      </p>
    </article>
  );
}

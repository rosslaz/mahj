'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useClub } from '@/lib/use-club';
import { useActivity, ACTIVITY_TYPE_LABEL, activityHasScoring } from '@/lib/use-activity';

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const clubSlug = params.slug as string;
  const activitySlug = params.activitySlug as string;
  const cb = useClub(clubSlug);
  const act = useActivity(cb.club?.id, activitySlug);

  if (cb.loading || act.loading) {
    return <p className="text-ink/40 italic">Loading…</p>;
  }
  if (act.notFound) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Activity Not Found</h1>
        <p className="text-ink/60 mb-6">No activity at this URL.</p>
        <Link href={`/c/${clubSlug}`} className="btn btn-ghost">← Club home</Link>
      </div>
    );
  }
  // Privacy: members of the club can see all activities; non-members only see
  // public-AND-club-is-public ones.
  if (act.activity && !cb.isMember && !(act.activity.is_public && cb.club?.is_public)) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Private Activity</h1>
        <p className="text-ink/60 mb-6">Ask a member for access.</p>
        <Link href="/clubs/join" className="btn">Join the Club</Link>
      </div>
    );
  }
  if (!act.activity) return null;

  const base = `/c/${clubSlug}/a/${activitySlug}`;
  const showScoringLinks = activityHasScoring(act.activity.type);

  const links = [
    { href: base, label: 'Overview', exact: true },
    { href: `${base}/events`, label: act.activity.type === 'open_play' ? 'Sessions'
      : act.activity.type === 'class' ? 'Sessions'
      : 'Events' },
  ];
  if (showScoringLinks) {
    links.push({ href: `${base}/leaderboard`, label: 'Leaderboard' });
  }
  if (cb.isAdmin) {
    links.push({ href: `${base}/settings`, label: 'Settings' });
  }

  function isActive(href: string, exact = false) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-ink/10 pb-4 -mt-4">
        {/* Full path breadcrumb: My Clubs / Lazar / Tuesday League */}
        <nav className="text-xs tracking-[0.2em] uppercase flex items-center gap-2 flex-wrap">
          <Link href="/clubs" className="text-ink/40 hover:text-cinnabar transition-colors">My Clubs</Link>
          <span className="text-ink/20">/</span>
          <Link href={`/c/${clubSlug}`} className="text-ink/40 hover:text-cinnabar transition-colors">{cb.club?.name}</Link>
          <span className="text-ink/20">/</span>
          <span className="text-ink/80">{act.activity.name}</span>
          <span className="ml-2 text-[10px] tracking-[0.25em] uppercase text-ink/40">
            {ACTIVITY_TYPE_LABEL[act.activity.type]}
          </span>
        </nav>
        <nav className="mt-3 flex gap-5 flex-wrap text-sm overflow-x-auto">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap transition-colors ${
                isActive(l.href, l.exact)
                  ? 'text-cinnabar border-b-2 border-cinnabar pb-1 -mb-px'
                  : 'text-ink/60 hover:text-ink pb-1'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>

      {children}
    </div>
  );
}

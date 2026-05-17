'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useLeague } from '@/lib/use-league';
import { useAuth } from '@/lib/use-auth';

export default function LeagueLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const slug = params.slug as string;
  const auth = useAuth();
  const lg = useLeague(slug);

  if (lg.loading || auth.loading) {
    return <p className="text-ink/40 italic">Loading league…</p>;
  }
  if (lg.notFound) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">League Not Found</h1>
        <p className="text-ink/60 mb-6">No league at <code>/l/{slug}</code>.</p>
        <Link href="/leagues" className="btn btn-ghost">My Leagues</Link>
      </div>
    );
  }
  // Visibility: if private and not a member, block.
  if (lg.league && !lg.league.is_public && !lg.isMember) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Private League</h1>
        <p className="text-ink/60 mb-6">
          <strong>{lg.league.name}</strong> is private. Ask a member for an invite or join code.
        </p>
        <Link href="/leagues/join" className="btn">Join with Code</Link>
      </div>
    );
  }

  const base = `/l/${slug}`;
  const links = [
    { href: base, label: 'Overview', exact: true },
    { href: `${base}/game-nights`, label: 'Game Nights' },
    { href: `${base}/players`, label: 'Players' },
    { href: `${base}/leaderboard`, label: 'Leaderboard' },
  ];
  if (lg.isAdmin) {
    links.push({ href: `${base}/admin`, label: 'Admin' });
  }
  if (lg.isOwner) {
    links.push({ href: `${base}/settings`, label: 'Settings' });
  }

  function isActive(href: string, exact = false) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <div className="space-y-8">
      {/* League header strip */}
      <div className="border-b border-ink/10 pb-5 -mt-4">
        <Link href="/leagues" className="text-xs tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">
          ← My Leagues
        </Link>
        <div className="flex items-baseline justify-between flex-wrap gap-2 mt-3">
          <div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2 className="font-display text-3xl md:text-4xl text-jade">{lg.league?.name}</h2>
              {lg.role && (
                <span className="text-[10px] tracking-[0.25em] uppercase text-ink/40">{lg.role}</span>
              )}
            </div>
          </div>
        </div>
        <nav className="mt-4 flex gap-5 flex-wrap text-sm overflow-x-auto">
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

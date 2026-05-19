'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useClub } from '@/lib/use-club';
import { useAuth } from '@/lib/use-auth';

export default function ClubLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const slug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(slug);

  if (cb.loading || auth.loading) {
    return <p className="text-ink/40 italic">Loading club…</p>;
  }
  if (cb.notFound) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Club Not Found</h1>
        <p className="text-ink/60 mb-6">No club at <code>/c/{slug}</code>.</p>
        <Link href="/clubs" className="btn btn-ghost">My Clubs</Link>
      </div>
    );
  }
  if (cb.club && !cb.club.is_public && !cb.isMember) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Private Club</h1>
        <p className="text-ink/60 mb-6">
          <strong>{cb.club.name}</strong> is private. Ask a member for an invite or join code.
        </p>
        <Link href="/clubs/join" className="btn">Join with Code</Link>
      </div>
    );
  }

  const base = `/c/${slug}`;
  // Only club-level links here. Activity nav happens inside each activity's layout.
  type NavLink = { href: string; label: string; exact?: boolean; action?: boolean };
  const links: NavLink[] = [
    { href: base, label: 'Overview', exact: true },
    { href: `${base}/members`, label: 'Members' },
  ];
  if (cb.isAdmin) {
    links.push({ href: `${base}/a/new`, label: '+ Add Activity', action: true });
    links.push({ href: `${base}/admin`, label: 'Admin' });
  }
  if (cb.isOwner) links.push({ href: `${base}/settings`, label: 'Settings' });

  function isActive(href: string, exact = false) {
    if (exact) return pathname === href;
    // Mark club-level nav inactive when on an activity page so user sees activity-only state.
    if (pathname.startsWith(`${base}/a/`)) return false;
    return pathname.startsWith(href);
  }

  // When deeply inside an activity, show a breadcrumb instead of full club nav,
  // because the activity has its own nav.
  const insideActivity = pathname.startsWith(`${base}/a/`);

  return (
    <div className="space-y-8">
      <div className="border-b border-ink/10 pb-5 -mt-4">
        <Link href="/clubs" className="text-xs tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">
          ← My Clubs
        </Link>
        <div className="flex items-baseline justify-between flex-wrap gap-2 mt-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <Link href={base} className="font-display text-3xl md:text-4xl text-jade hover:text-cinnabar transition-colors">{cb.club?.name}</Link>
            {cb.role && (
              <span className="text-[10px] tracking-[0.25em] uppercase text-ink/40">{cb.role}</span>
            )}
          </div>
        </div>
        {!insideActivity && (
          <nav className="mt-4 flex gap-5 flex-wrap text-sm overflow-x-auto">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap transition-colors ${
                  isActive(l.href, l.exact)
                    ? 'text-cinnabar border-b-2 border-cinnabar pb-1 -mb-px'
                    : l.action
                      ? 'text-jade hover:text-cinnabar font-medium pb-1'
                      : 'text-ink/60 hover:text-ink pb-1'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {children}
    </div>
  );
}

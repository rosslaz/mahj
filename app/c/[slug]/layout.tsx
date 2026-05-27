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
  if (cb.isOwner) {
    links.push({ href: `${base}/settings`, label: 'Settings' });
    links.push({ href: `${base}/billing`, label: 'Billing' });
  }

  function isActive(href: string, exact = false) {
    if (exact) return pathname === href;
    // Mark club-level nav inactive when on an activity page so user sees activity-only state.
    if (pathname.startsWith(`${base}/a/`)) return false;
    return pathname.startsWith(href);
  }

  // When deeply inside an activity, render NO club chrome — the activity
  // layout takes over completely with its own breadcrumb that goes all the
  // way back to "My Clubs". This avoids stacking redundant titles.
  const insideActivity = pathname.startsWith(`${base}/a/`);

  if (insideActivity) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-ink/10 pb-4 -mt-4">
        {/* Compact breadcrumb: My Clubs / Club Name */}
        <nav className="text-xs tracking-[0.2em] uppercase flex items-center gap-2 flex-wrap">
          <Link href="/clubs" className="text-ink/40 hover:text-cinnabar transition-colors">My Clubs</Link>
          <span className="text-ink/20">/</span>
          <span className="text-ink/80">{cb.club?.name}</span>
          {cb.role && (
            <span className="ml-2 text-[10px] tracking-[0.25em] uppercase text-ink/40">{cb.role}</span>
          )}
        </nav>
        <nav className="mt-3 flex gap-5 flex-wrap text-sm overflow-x-auto">
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
      </div>

      {children}
    </div>
  );
}

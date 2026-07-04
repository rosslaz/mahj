'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useClub } from '@/lib/use-club';
import { useAuth } from '@/lib/use-auth';

export default function ClubLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const slug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(slug);

  if (cb.loading || auth.loading) {
    return <p className="text-ink/60 italic">Loading club…</p>;
  }
  if (cb.error) {
    // Load failure ≠ not found (audit #11): the hook already retried;
    // offer a manual retry instead of a confident "Club Not Found".
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">Connection Trouble</h1>
        <p className="text-ink/60 mb-6">{cb.error}</p>
        <button onClick={cb.retry} className="btn btn-jade">Try again</button>
      </div>
    );
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

  // Top-level nav items. "+ Add Activity" used to live here as an action item,
  // but it's not navigation — it's been moved to the Overview page as a CTA.
  //
  // Owner-only items (Settings, Billing) get grouped into a "Manage" dropdown
  // together with Admin to keep the bar uncluttered. Non-owner admins see
  // "Admin" as a direct link since a dropdown of one item is silly.
  type NavLink = { href: string; label: string; exact?: boolean };
  const links: NavLink[] = [
    { href: base, label: 'Overview', exact: true },
    { href: `${base}/members`, label: 'Members' },
  ];
  if (cb.isAdmin && !cb.isOwner) {
    links.push({ href: `${base}/admin`, label: 'Admin' });
  }

  // Owner-only Manage dropdown items
  const manageItems: NavLink[] = cb.isOwner ? [
    { href: `${base}/admin`, label: 'Admin' },
    { href: `${base}/settings`, label: 'Settings' },
    { href: `${base}/billing`, label: 'Billing' },
  ] : [];

  function isActive(href: string, exact = false) {
    if (exact) return pathname === href;
    if (pathname.startsWith(`${base}/a/`)) return false;
    return pathname.startsWith(href);
  }

  // Is the user currently on any of the Manage pages? Used to mark the
  // Manage trigger active.
  const isManageActive = manageItems.some((m) => isActive(m.href));

  // When deeply inside an activity, render NO club chrome — the activity
  // layout takes over completely with its own breadcrumb.
  const insideActivity = pathname.startsWith(`${base}/a/`);
  if (insideActivity) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-ink/10 pb-4 -mt-4">
        {/* Compact breadcrumb: My Clubs / Club Name */}
        <nav className="text-xs tracking-[0.2em] uppercase flex items-center gap-2 flex-wrap">
          <Link href="/clubs" className="text-ink/60 hover:text-cinnabar transition-colors">My Clubs</Link>
          <span className="text-ink/20">/</span>
          <span className="text-ink/80">{cb.club?.name}</span>
          {cb.role && (
            <span className="ml-2 text-xs tracking-[0.25em] uppercase text-ink/60">{cb.role}</span>
          )}
        </nav>
        <nav className="mt-3 flex gap-5 flex-wrap text-sm items-center">
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
          {manageItems.length > 0 && (
            <ManageDropdown
              items={manageItems}
              isActive={isManageActive}
              currentPath={pathname}
            />
          )}
        </nav>
      </div>

      {children}
    </div>
  );
}

/**
 * "Manage ▾" trigger that opens a dropdown of admin/settings/billing.
 * Closes on click-outside or Esc.
 */
function ManageDropdown({
  items,
  isActive,
  currentPath,
}: {
  items: { href: string; label: string }[];
  isActive: boolean;
  currentPath: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className={`whitespace-nowrap transition-colors flex items-center gap-1 ${
          isActive
            ? 'text-cinnabar border-b-2 border-cinnabar pb-1 -mb-px'
            : 'text-ink/60 hover:text-ink pb-1'
        }`}
      >
        Manage
        <span className={`text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div
          className="absolute right-0 sm:left-0 top-full mt-2 min-w-[180px] bg-bone border border-ink/15 shadow-sm z-50 py-1"
          role="menu"
        >
          {items.map((m) => {
            const active = currentPath === m.href || currentPath.startsWith(m.href + '/');
            return (
              <Link
                key={m.href}
                href={m.href}
                onClick={() => setOpen(false)}
                className={`block px-4 py-2 text-sm transition-colors ${
                  active ? 'text-cinnabar bg-cinnabar/5' : 'text-ink/70 hover:bg-ink/5 hover:text-ink'
                }`}
                role="menuitem"
              >
                {m.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

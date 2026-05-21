'use client';

import { useEffect } from 'react';
import { getBrowserSupabase } from './supabase-browser';

/**
 * App icon badge management.
 *
 * Sets the home-screen icon badge to the number of actionable items for the
 * signed-in user. For now: count of pending signup approvals on events the
 * user hosts.
 *
 * Runs on:
 *   - App load (after auth resolves)
 *   - Tab/PWA refocus (so the badge updates when the user comes back without
 *     a full reload)
 *
 * The Badging API gracefully no-ops on unsupported browsers (we feature-detect
 * before calling).
 *
 * Future: when more actionable categories exist (event reminders due, etc.)
 * extend the COUNT computation. Keep the single setAppBadge call here as the
 * one source of truth for what shows on the icon.
 */
export function useAppBadge(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) {
      // Signed-out users shouldn't show a badge from a previous session
      clearBadgeSafely();
      return;
    }

    let cancelled = false;

    const compute = async () => {
      const supabase = getBrowserSupabase();
      // Find events where this user is the host, not deleted, and count
      // pending signups on them. One round trip via a join filter.
      //
      // We could do this as a single nested query, but Supabase's join
      // syntax with status filtering inside child tables is awkward —
      // simpler to do two queries.
      const { data: hostedEvents } = await supabase
        .from('events')
        .select('id')
        .eq('host_player_id', userId)
        .is('deleted_at', null)
        .eq('status', 'active');

      const eventIds = ((hostedEvents as any[]) || []).map((e) => e.id);
      if (eventIds.length === 0) {
        if (!cancelled) clearBadgeSafely();
        return;
      }

      const { count } = await supabase
        .from('night_signups')
        .select('id', { count: 'exact', head: true })
        .in('event_id', eventIds)
        .eq('status', 'pending');

      if (cancelled) return;
      if (!count || count === 0) clearBadgeSafely();
      else setBadgeSafely(count);
    };

    compute();

    // Recompute when the tab/PWA regains focus. Reuses the visibility +
    // focus listeners pattern from use-refresh-on-focus.
    const onVisible = () => { if (document.visibilityState === 'visible') compute(); };
    const onFocus = () => compute();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [userId]);
}

function setBadgeSafely(count: number) {
  try {
    const nav = navigator as any;
    if (typeof nav.setAppBadge === 'function') {
      nav.setAppBadge(count).catch(() => { /* user denied or unsupported, ignore */ });
    }
  } catch { /* swallow — badge is non-essential */ }
}

function clearBadgeSafely() {
  try {
    const nav = navigator as any;
    if (typeof nav.clearAppBadge === 'function') {
      nav.clearAppBadge().catch(() => { /* ignore */ });
    }
  } catch { /* ignore */ }
}

'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { getBrowserSupabase } from './supabase-browser';

export type ActivityType = 'league' | 'tournament' | 'class' | 'open_play';

export type Activity = {
  id: string;
  club_id: string;
  slug: string;
  name: string;
  description: string | null;
  type: ActivityType;
  is_public: boolean;
  starts_on: string | null;
  ends_on: string | null;
};

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  league: 'League',
  tournament: 'Tournament',
  class: 'Class',
  open_play: 'Open Play',
};

export const ACTIVITY_TYPE_DESCRIPTION: Record<ActivityType, string> = {
  league: 'Ongoing nights with lifetime standings.',
  tournament: 'A bounded competition with its own leaderboard.',
  class: 'Instructional sessions with a teacher.',
  open_play: 'Drop-in play. Just show up.',
};

// Whether an activity type uses the structured mahjong machinery
// (tables, winds, scoring). League, tournament, and open play do; classes
// are attendance-only. Note: "has scoring" is distinct from "feeds league
// standings" — open-play games are scored and count toward a player's lifetime
// stats, but the per-activity `leaderboard` view stays league/tournament-only.
export function activityHasScoring(type: ActivityType): boolean {
  return type === 'league' || type === 'tournament' || type === 'open_play';
}

export type ActivityContextState = {
  loading: boolean;
  activity: Activity | null;
  // Definitively no such activity (query succeeded, zero rows).
  notFound: boolean;
  // Load failure after internal retries — distinct from notFound
  // (2026-07 audit #11; see use-club.ts for the full note).
  error: string | null;
  retry: () => void;
};

const MAX_ATTEMPTS = 3;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared-instance context — same pattern and rationale as ClubContext in
// use-club.ts (audit #14 + the #11 residual). The activity layout provides;
// pages underneath read the shared state.
const ActivityContext = createContext<
  (ActivityContextState & { clubId: string; activitySlug: string }) | null
>(null);

/** Mounted by the activity layout around its children. */
export function ActivityProvider({
  clubId,
  activitySlug,
  value,
  children,
}: {
  clubId: string;
  activitySlug: string;
  value: ActivityContextState;
  children: ReactNode;
}) {
  return createElement(ActivityContext.Provider, { value: { ...value, clubId, activitySlug } }, children);
}

/**
 * Context-aware: returns the layout's shared instance when its keys match;
 * otherwise runs standalone. Signature and return shape unchanged.
 */
export function useActivity(
  clubId: string | undefined | null,
  activitySlug: string | undefined | null,
): ActivityContextState {
  const ctx = useContext(ActivityContext);
  const provided =
    ctx && clubId && activitySlug && ctx.clubId === clubId && ctx.activitySlug === activitySlug
      ? ctx
      : null;
  const standalone = useActivityStandalone(
    provided ? null : clubId,
    provided ? null : activitySlug,
  );
  return provided ?? standalone;
}

function useActivityStandalone(
  clubId: string | undefined | null,
  activitySlug: string | undefined | null,
): ActivityContextState {
  const supabase = getBrowserSupabase();
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  const [state, setState] = useState<Omit<ActivityContextState, 'retry'>>({
    loading: true, activity: null, notFound: false, error: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!clubId || !activitySlug) {
      setState({ loading: false, activity: null, notFound: !!activitySlug, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      let lastError = '';
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) await delay(attempt === 2 ? 400 : 1200);
        if (cancelled) return;
        const res = await supabase
          .from('activities')
          .select('*')
          .eq('club_id', clubId)
          .eq('slug', activitySlug)
          .is('deleted_at', null)
          .maybeSingle();
        if (cancelled) return;
        if (res.error) { lastError = res.error.message; continue; }
        if (!res.data) {
          setState({ loading: false, activity: null, notFound: true, error: null });
          return;
        }
        setState({ loading: false, activity: res.data as Activity, notFound: false, error: null });
        return;
      }
      if (cancelled) return;
      console.warn('[useActivity] load failed after retries:', lastError);
      setState({
        loading: false, activity: null, notFound: false,
        error: "Couldn't load the activity — check your connection.",
      });
    })();
    return () => { cancelled = true; };
  }, [clubId, activitySlug, supabase, reloadKey]);

  return { ...state, retry };
}

'use client';

import { useEffect, useState } from 'react';
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
// (tables, winds, scoring, leaderboard). Classes and open play don't.
export function activityHasScoring(type: ActivityType): boolean {
  return type === 'league' || type === 'tournament';
}

export type ActivityContextState = {
  loading: boolean;
  activity: Activity | null;
  notFound: boolean;
};

export function useActivity(clubId: string | undefined | null, activitySlug: string | undefined | null): ActivityContextState {
  const supabase = getBrowserSupabase();
  const [state, setState] = useState<ActivityContextState>({ loading: true, activity: null, notFound: false });

  useEffect(() => {
    let cancelled = false;
    if (!clubId || !activitySlug) {
      setState({ loading: false, activity: null, notFound: !!activitySlug });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('activities')
        .select('*')
        .eq('club_id', clubId)
        .eq('slug', activitySlug)
        .is('deleted_at', null)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        setState({ loading: false, activity: null, notFound: true });
        return;
      }
      setState({ loading: false, activity: data as Activity, notFound: false });
    })();
    return () => { cancelled = true; };
  }, [clubId, activitySlug, supabase]);

  return state;
}

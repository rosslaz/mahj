'use client';

import { useAuth } from '@/lib/use-auth';
import { useAppBadge } from '@/lib/use-app-badge';

/**
 * Headless component that keeps the app icon badge in sync with actionable
 * counts for the signed-in user. Renders nothing — just runs the hook.
 *
 * Mounted in the root layout so it works on every page (deep-link, direct
 * navigation, etc), not just the dashboard.
 */
export default function AppBadgeManager() {
  const auth = useAuth();
  useAppBadge(auth.userId);
  return null;
}

'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import {
  detectPushSupport,
  subscribeToPush,
  getExistingSubscription,
  unsubscribeFromPush,
  type PushSupportLevel,
} from '@/lib/push-client';
import {
  registerPushSubscription,
  unregisterPushSubscription,
  sendTestPush,
  updateNotificationPreferences,
} from '@/app/actions/push';

type Device = {
  id: string;
  endpoint: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string;
};

type Prefs = {
  sound: boolean;
  vibration: boolean;
  event_reminders: boolean;
  signup_activity: boolean;
  club_membership: boolean;
};

const DEFAULT_PREFS: Prefs = {
  sound: true,
  vibration: true,
  event_reminders: true,
  signup_activity: true,
  club_membership: true,
};

// Friendly labels for known user-agent fragments. Pure cosmetic.
function labelForUA(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone / iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Browser';
}

function browserName(ua: string | null): string {
  if (!ua) return '';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  return '';
}

export default function NotificationsPanel() {
  const auth = useAuth();
  const supabase = getBrowserSupabase();
  const [support, setSupport] = useState<PushSupportLevel | null>(null);
  const [thisDeviceSubscribed, setThisDeviceSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Detect support on mount + check whether THIS device is already subscribed
  useEffect(() => {
    setSupport(detectPushSupport());
    (async () => {
      const existing = await getExistingSubscription();
      setThisDeviceSubscribed(!!existing);
    })();
  }, []);

  // Load devices + prefs from the server
  const loadData = async () => {
    if (!auth.userId) return;
    const [d, p] = await Promise.all([
      supabase.from('push_subscriptions').select('id, endpoint, user_agent, created_at, last_used_at').order('last_used_at', { ascending: false }),
      supabase.from('notification_preferences').select('*').maybeSingle(),
    ]);
    setDevices(((d.data as any[]) || []) as Device[]);
    if (p.data) {
      setPrefs({
        sound: (p.data as any).sound !== false,
        vibration: (p.data as any).vibration !== false,
        event_reminders: (p.data as any).event_reminders !== false,
        signup_activity: (p.data as any).signup_activity !== false,
        club_membership: (p.data as any).club_membership !== false,
      });
    }
    setPrefsLoaded(true);
  };
  useEffect(() => { loadData(); /* eslint-disable-next-line */ }, [auth.userId]);

  async function handleEnable() {
    setError(null);
    setBusy(true);
    try {
      const sub = await subscribeToPush();
      if (!sub) throw new Error('Subscription failed.');
      const res = await registerPushSubscription(sub);
      if (!res.ok) throw new Error(res.error);
      setThisDeviceSubscribed(true);
      await loadData();
    } catch (e: any) {
      setError(e?.message || 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisableThisDevice() {
    setError(null);
    setBusy(true);
    try {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) {
        await unregisterPushSubscription(endpoint);
      }
      setThisDeviceSubscribed(false);
      await loadData();
    } catch (e: any) {
      setError(e?.message || 'Could not disable.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveDevice(device: Device) {
    setError(null);
    if (!confirm(`Remove notifications for ${labelForUA(device.user_agent)}?`)) return;
    setBusy(true);
    try {
      const res = await unregisterPushSubscription(device.endpoint);
      if (!res.ok) throw new Error(res.error);
      // If we just deleted THIS device, also unsubscribe locally
      const current = await getExistingSubscription();
      if (current?.endpoint === device.endpoint) {
        await unsubscribeFromPush();
        setThisDeviceSubscribed(false);
      }
      await loadData();
    } catch (e: any) {
      setError(e?.message || 'Could not remove.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setError(null);
    setTestResult(null);
    setBusy(true);
    try {
      const res = await sendTestPush();
      if (!res.ok) throw new Error(res.error);
      const { delivered, attempted } = res.data!;
      if (delivered === 0) {
        setTestResult('No devices received it. Try enabling notifications on this device first.');
      } else if (delivered === attempted) {
        setTestResult(`Sent to ${delivered} device${delivered === 1 ? '' : 's'}. Check for the notification.`);
      } else {
        setTestResult(`Sent to ${delivered} of ${attempted} devices. Check for the notification.`);
      }
    } catch (e: any) {
      setError(e?.message || 'Test failed.');
    } finally {
      setBusy(false);
    }
  }

  async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    const prev = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);  // optimistic
    try {
      const res = await updateNotificationPreferences({ [key]: value });
      if (!res.ok) throw new Error(res.error);
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
      setPrefs(prev);  // rollback
    }
  }

  if (support === null) {
    return <p className="text-ink/40 italic">Checking notification support…</p>;
  }

  return (
    <div className="space-y-8 mt-12 pt-10 border-t border-ink/15">
      <header>
        <h2 className="font-display text-3xl mb-2">Notifications</h2>
        <p className="text-sm text-ink/60 italic">
          Get a push notification when something needs your attention. Each device you sign in on needs its own permission.
        </p>
      </header>

      {/* Per-device controls */}
      <section className="tile-border p-6 space-y-5">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h3 className="font-display text-xl">This device</h3>
          {thisDeviceSubscribed && (
            <span className="text-[11px] tracking-[0.2em] uppercase text-jade">Enabled ✓</span>
          )}
        </div>

        {support === 'unsupported' && (
          <p className="text-sm text-ink/60">This browser doesn't support push notifications.</p>
        )}

        {support === 'ios-needs-install' && (
          <div className="space-y-3">
            <p className="text-sm text-ink/70">
              On iPhone or iPad, push notifications work only when Pungctual is installed to your home screen.
            </p>
            <ol className="text-sm text-ink/60 list-decimal list-inside space-y-1">
              <li>Tap the Share button in Safari</li>
              <li>Choose <strong>Add to Home Screen</strong></li>
              <li>Open Pungctual from your home screen</li>
              <li>Come back to this page and enable notifications</li>
            </ol>
          </div>
        )}

        {support === 'permission-denied' && (
          <div className="space-y-3">
            <p className="text-sm text-ink/70">
              Notifications are blocked for this site. You'll need to unblock them in your browser settings.
            </p>
            <p className="text-xs text-ink/50 italic">
              In Chrome / Edge: click the padlock in the address bar → Site settings → Notifications → Allow. Then refresh.
            </p>
          </div>
        )}

        {support === 'supported' && !thisDeviceSubscribed && (
          <button onClick={handleEnable} disabled={busy} className="btn btn-jade">
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
        )}

        {support === 'supported' && thisDeviceSubscribed && (
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={handleTest} disabled={busy} className="btn">
              {busy ? 'Sending…' : 'Send test notification'}
            </button>
            <button onClick={handleDisableThisDevice} disabled={busy} className="btn btn-ghost text-xs">
              Disable on this device
            </button>
          </div>
        )}

        {testResult && (
          <p className="text-sm text-jade">{testResult}</p>
        )}
        {error && (
          <p className="text-sm text-cinnabar">{error}</p>
        )}
      </section>

      {/* All devices list */}
      {devices.length > 0 && (
        <section>
          <h3 className="font-display text-xl mb-3">Subscribed devices</h3>
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {devices.map((d) => {
              const label = labelForUA(d.user_agent);
              const browser = browserName(d.user_agent);
              const created = new Date(d.created_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              });
              return (
                <li key={d.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm">
                      <strong>{label}</strong>
                      {browser && <span className="text-ink/50"> · {browser}</span>}
                    </div>
                    <div className="text-xs text-ink/40 italic">Added {created}</div>
                  </div>
                  <button
                    onClick={() => handleRemoveDevice(d)}
                    className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Preference toggles */}
      <section className="tile-border p-6 space-y-5">
        <h3 className="font-display text-xl">Send me notifications about</h3>
        {!prefsLoaded ? (
          <p className="text-ink/40 italic text-sm">Loading preferences…</p>
        ) : (
          <div className="space-y-3">
            <ToggleRow
              label="Event reminders"
              hint="24 hours before events you're signed up for"
              checked={prefs.event_reminders}
              onChange={(v) => setPref('event_reminders', v)}
              disabled={busy}
            />
            <ToggleRow
              label="Signup activity"
              hint="When players join or leave your events"
              checked={prefs.signup_activity}
              onChange={(v) => setPref('signup_activity', v)}
              disabled={busy}
            />
            <ToggleRow
              label="Club membership"
              hint="When players join or leave your clubs"
              checked={prefs.club_membership}
              onChange={(v) => setPref('club_membership', v)}
              disabled={busy}
            />
            <div className="pt-3 mt-3 border-t border-ink/10 space-y-3">
              <ToggleRow
                label="Sound"
                hint="Play the system notification sound"
                checked={prefs.sound}
                onChange={(v) => setPref('sound', v)}
                disabled={busy}
              />
              <ToggleRow
                label="Vibration"
                hint="Vibrate when notifications arrive (mobile)"
                checked={prefs.vibration}
                onChange={(v) => setPref('vibration', v)}
                disabled={busy}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ToggleRow({
  label, hint, checked, onChange, disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-ink/50 italic">{hint}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="accent-jade w-4 h-4 mt-1 flex-shrink-0"
      />
    </label>
  );
}

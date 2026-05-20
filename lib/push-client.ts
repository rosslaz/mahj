/**
 * Client-side push subscription manager.
 *
 * Flow:
 *   1. User clicks "Enable notifications" → call subscribe()
 *   2. Browser shows permission prompt
 *   3. If granted, we get a PushSubscription from the service worker
 *   4. POST it to our server (lib action) to store in push_subscriptions table
 *   5. Server uses it to send notifications later
 *
 * Unsubscribe:
 *   - Local: call PushSubscription.unsubscribe() to revoke the browser sub
 *   - Server: delete the row in push_subscriptions
 *   - Both should happen; unsubscribe() handles the deletion side.
 */

export type PushSupportLevel =
  | 'supported'                  // can subscribe right now
  | 'permission-denied'          // user previously said no — they have to flip it manually
  | 'unsupported'                // browser doesn't support web push at all
  | 'ios-needs-install';         // iOS Safari but PWA not installed

export function detectPushSupport(): PushSupportLevel {
  if (typeof window === 'undefined') return 'unsupported';

  // iOS Safari supports web push only when the site is installed as a PWA.
  // Detection: iOS device + standalone mode = installed PWA.
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  if (isIos && !isStandalone) return 'ios-needs-install';

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }

  if (Notification.permission === 'denied') return 'permission-denied';
  return 'supported';
}

// Browser-supplied VAPID public key (base64url) → Uint8Array for PushManager.subscribe
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type SerializedSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
};

function serializeSubscription(sub: PushSubscription): SerializedSubscription {
  const json = sub.toJSON();
  // toJSON returns { endpoint, keys: { p256dh, auth }, expirationTime }
  return {
    endpoint: json.endpoint!,
    keys: {
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
    },
    userAgent: navigator.userAgent,
  };
}

/**
 * Request permission, register a subscription with the browser, and return
 * the serialized form. Caller is responsible for sending it to the server.
 */
export async function subscribeToPush(): Promise<SerializedSubscription | null> {
  const support = detectPushSupport();
  if (support !== 'supported') {
    throw new Error(
      support === 'ios-needs-install' ? 'Install Pungctual to your home screen first.'
      : support === 'permission-denied' ? 'Notification permission was previously denied. Enable it in browser settings.'
      : 'This browser does not support push notifications.'
    );
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    throw new Error('Push is not configured (missing VAPID public key).');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission denied.');
  }

  const registration = await navigator.serviceWorker.ready;
  // Try existing subscription first — avoid creating duplicates
  let sub = await registration.pushManager.getSubscription();
  if (!sub) {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,  // required: every push must show a notification
      // TS strict mode wants a plain BufferSource here. Casting to BufferSource
      // is fine — the runtime accepts a Uint8Array.
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
    });
  }
  return serializeSubscription(sub);
}

/**
 * Get the current browser subscription, if any, without re-prompting.
 */
export async function getExistingSubscription(): Promise<SerializedSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return null;
  return serializeSubscription(sub);
}

/**
 * Unsubscribe the current browser subscription. Server-side deletion is
 * the caller's responsibility (we don't know endpoint → row mapping here).
 */
export async function unsubscribeFromPush(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';

/**
 * "Danger zone" section on the profile page. Contains the delete-account flow.
 *
 * Flow:
 *   1. User clicks "Delete my account" — reveals a confirmation card
 *   2. Confirmation card shows what will happen + a text field for "DELETE"
 *   3. User types DELETE (case-sensitive) — enables the final button
 *   4. Final click — calls deleteMyAccount server action
 *   5. On success, signs out via Supabase auth, redirects to /sign-in with a
 *      farewell query string the sign-in page can display
 */
export default function DangerZone() {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setError(null);
    setBusy(true);
    try {
      const { deleteMyAccount } = await import('@/app/actions/delete-account');
      const res = await deleteMyAccount(confirmText);
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      // Sign out client-side. The auth.users row is already gone server-side,
      // but the cookie is still here — clearing it cleanly.
      const supabase = getBrowserSupabase();
      try { await supabase.auth.signOut(); } catch { /* ignore */ }
      // Redirect to a farewell screen
      router.replace('/sign-in?deleted=1');
    } catch (e: any) {
      setError(e?.message || 'Could not delete account.');
      setBusy(false);
    }
  }

  return (
    <section className="mt-16 pt-10 border-t border-cinnabar/30">
      <h2 className="font-display text-3xl mb-2 text-cinnabar">Danger Zone</h2>
      <p className="text-sm text-ink/60 italic mb-6">
        Permanent actions you can't undo.
      </p>

      {!showConfirm ? (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="btn border border-cinnabar text-cinnabar hover:bg-cinnabar hover:text-bone"
        >
          Delete my account
        </button>
      ) : (
        <div className="tile-border p-6 border-cinnabar/40 bg-cinnabar/5 space-y-5">
          <div>
            <h3 className="font-display text-xl text-cinnabar mb-3">
              Are you absolutely sure?
            </h3>
            <p className="text-sm text-ink/80 mb-3">
              This will permanently:
            </p>
            <ul className="text-sm text-ink/70 list-disc list-inside space-y-1 mb-3">
              <li>Remove your name, email, phone, and address from our systems</li>
              <li>Cancel all your event signups</li>
              <li>Remove you from every club you've joined</li>
              <li>Sign you out everywhere and prevent future sign-ins under this email</li>
              <li>Reassign any events you host to the club owner</li>
            </ul>
            <p className="text-sm text-ink/80">
              Your game history will be <strong>preserved but anonymized</strong> — other players will still see the games they played, but your name will no longer appear.
            </p>
          </div>

          <div className="border-t border-cinnabar/20 pt-4 space-y-3">
            <label className="block text-sm text-ink/80">
              To confirm, type <strong>DELETE</strong> (all caps):
            </label>
            <input
              type="text"
              className="input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {error && <p className="text-cinnabar text-sm">{error}</p>}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy || confirmText !== 'DELETE'}
              className="btn bg-cinnabar text-bone border border-cinnabar disabled:bg-cinnabar/40"
            >
              {busy ? 'Deleting…' : 'Yes, delete my account'}
            </button>
            <button
              type="button"
              onClick={() => { setShowConfirm(false); setConfirmText(''); setError(null); }}
              disabled={busy}
              className="btn btn-ghost"
            >
              Never mind
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

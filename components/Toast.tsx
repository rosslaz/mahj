'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

/**
 * Lightweight toast + inline-confirm primitives for Pungctual.
 *
 * Why this exists: the app previously used native alert()/confirm(), which in
 * an installed PWA look unstyled and untrusted ("pungctual.com says…") and
 * block the whole screen. These primitives match the app's visual language
 * (jade success, cinnabar error/destructive) and stay out of the way.
 *
 * Two pieces:
 *   1. useToast() — transient messages + a promise-based styled confirm.
 *      toast(msg, 'success'|'error'|'info'); await confirm({...}).
 *      Wrap a page's tree in <ToastProvider> to enable both.
 *   2. <InlineConfirm/> — wraps a destructive action button. First tap swaps
 *      the button for "Confirm / Cancel" in place (no modal, no screen block).
 *      Reversible/trivial actions should NOT use this — just call the action.
 */

// ----------------------------------------------------------------------------
// Toast + Confirm context
// ----------------------------------------------------------------------------

export type ToastVariant = 'success' | 'error' | 'info';
type ToastItem = { id: number; message: string; variant: ToastVariant };

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // 'danger' tints the confirm button cinnabar; 'normal' uses the default.
  tone?: 'danger' | 'normal';
};

type ConfirmState = ConfirmOptions & { resolve: (ok: boolean) => void };

type ToastCtx = {
  toast: (message: string, variant?: ToastVariant) => void;
  // Promise-based styled confirm for mid-flow gates where an inline two-step
  // doesn't fit (e.g. a conditional branch inside an async handler). Resolves
  // true if confirmed, false if cancelled/dismissed.
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const ToastContext = createContext<ToastCtx | null>(null);

let _idSeq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = ++_idSeq;
    setItems((prev) => [...prev, { id, message, variant }]);
    // Errors linger a touch longer than confirmations — they carry more weight.
    const ttl = variant === 'error' ? 5000 : 3500;
    const handle = setTimeout(() => dismiss(id), ttl);
    timers.current.set(id, handle);
  }, [dismiss]);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);

  const resolveConfirm = useCallback((ok: boolean) => {
    setConfirmState((prev) => {
      prev?.resolve(ok);
      return null;
    });
  }, []);

  // Clear any pending timers on unmount
  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach((t) => clearTimeout(t)); map.clear(); };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, confirm }}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
      {confirmState && <ConfirmDialog state={confirmState} onResolve={resolveConfirm} />}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail soft: if someone calls useToast outside a provider, fall back to a
    // no-op rather than crashing the page. (Shouldn't happen in practice.)
    // confirm resolves true so a missing provider doesn't silently block actions.
    return { toast: () => {}, confirm: async () => true };
  }
  return ctx;
}

// Styled modal confirm — matches the app's dialog language (see the modals in
// the event page). Used only for mid-flow gates; button-level destructive
// actions should prefer <InlineConfirm/>.
function ConfirmDialog({ state, onResolve }: { state: ConfirmState; onResolve: (ok: boolean) => void }) {
  const danger = state.tone === 'danger';
  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 fade-up"
      onClick={() => onResolve(false)}
    >
      <div
        className="bg-bone tile-border w-full max-w-sm p-7"
        onClick={(e) => e.stopPropagation()}
      >
        {state.title && <h3 className="font-display text-2xl mb-2">{state.title}</h3>}
        <p className="text-sm text-ink/70 mb-6 leading-relaxed">{state.message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => onResolve(false)} className="btn btn-ghost">
            {state.cancelLabel ?? 'Cancel'}
          </button>
          <button
            onClick={() => onResolve(true)}
            className={danger ? 'btn' : 'btn btn-jade'}
          >
            {state.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={[
            'pointer-events-auto w-full text-left px-5 py-3 shadow-lg border text-sm tracking-[0.05em] fade-up',
            t.variant === 'success' ? 'bg-jade text-bone border-jade' : '',
            t.variant === 'error' ? 'bg-cinnabar text-bone border-cinnabar' : '',
            t.variant === 'info' ? 'bg-ink text-bone border-ink' : '',
          ].join(' ')}
          // Tapping dismisses early; title hints at that without shouting.
          title="Dismiss"
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Inline confirm — for destructive actions only
// ----------------------------------------------------------------------------

/**
 * Wraps a single destructive action in an inline two-step confirm. The trigger
 * you pass renders normally; on first activation it swaps in place to a
 * "{confirmLabel} / Cancel" pair. Confirming calls onConfirm and reverts.
 *
 * Usage:
 *   <InlineConfirm
 *     confirmLabel="Remove"
 *     onConfirm={() => removePlayer(id)}
 *     render={(arm) => (
 *       <button onClick={arm} className="...">×</button>
 *     )}
 *   />
 *
 * The render prop receives `arm`, the function that flips into confirm mode,
 * so the host controls exactly how the resting-state trigger looks.
 */
export function InlineConfirm({
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  render,
  className = '',
}: {
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  render: (arm: () => void) => React.ReactNode;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Auto-disarm after a few seconds so a stray first tap doesn't leave a
  // primed confirm sitting on screen indefinitely.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) return <>{render(() => setArmed(true))}</>;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try { await onConfirm(); } finally { setBusy(false); setArmed(false); }
        }}
        disabled={busy}
        className="text-xs tracking-[0.15em] uppercase text-cinnabar hover:underline disabled:opacity-50"
      >
        {busy ? 'Working…' : confirmLabel}
      </button>
      <span className="text-ink/20">·</span>
      <button
        onClick={() => setArmed(false)}
        disabled={busy}
        className="text-xs tracking-[0.15em] uppercase text-ink/60 hover:text-ink"
      >
        {cancelLabel}
      </button>
    </span>
  );
}

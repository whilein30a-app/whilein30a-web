// W13 and W14: paying in the portal with Stripe's embedded checkout.
//
// Card details are typed into Stripe's own frame, loaded from js.stripe.com
// (never bundled, as Stripe requires). The portal only ever sees a session id.
// Plans and pushes are turned on by the stripe-webhook function after Stripe
// confirms the payment.
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Msg } from './components';
import { useSetting } from './plans';
import { supabase } from './supabase';

// Same release train as the functions (_shared/stripe.ts, 2026-08-26.dahlia).
const STRIPE_JS = 'https://js.stripe.com/dahlia/stripe.js';

type EmbeddedPage = { mount: (el: HTMLElement) => void; destroy: () => void };
type StripeJs = { createEmbeddedCheckoutPage: (o: { fetchClientSecret: () => Promise<string> }) => Promise<EmbeddedPage> };
declare global {
  interface Window { Stripe?: (key: string) => StripeJs }
}

let loading: Promise<void> | null = null;
function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = STRIPE_JS;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error('Could not load the payment form. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** The publishable key, or '' when online payment is off. */
export function useStripeKey(): string {
  const v = useSetting<{ key?: string }>('stripe_publishable').value;
  return v?.key && /^pk_(test|live)_/.test(v.key) ? v.key : '';
}

export type BillingStatus = {
  online: boolean; has_customer: boolean; checkout_open: boolean;
  subscription: null | { plan: string; billing: string; status: string; founding: boolean; renews_on: string | null; cancel_at_period_end: boolean };
};

export function useBillingStatus(listingId: string | undefined) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!listingId) return;
    let live = true;
    supabase.rpc('portal_billing_status', { p_listing_id: listingId }).then(({ data }) => { if (live) setStatus((data as BillingStatus) ?? null); });
    return () => { live = false; };
  }, [listingId, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { status, reload };
}

// Supabase functions hide the error body on non-2xx; read it ourselves.
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  let why = (data as { error?: string } | null)?.error ?? '';
  if (error && !why) {
    try { why = (await (error as unknown as { context?: Response }).context?.json())?.error ?? ''; } catch { /* ignore */ }
  }
  if (error || why) throw new Error(why || 'Something went wrong. Please try again.');
  return data as T;
}

export type CheckoutRequest =
  | { kind: 'plan'; listing_id: string; plan: string; billing: 'month' | 'year' }
  | { kind: 'push'; listing_id: string; deal_id: string };

export async function openBillingPortal(listingId: string) {
  const { url } = await invoke<{ url: string }>('stripe-portal', { listing_id: listingId });
  if (!/^https:\/\/billing\.stripe\.com\//.test(url)) throw new Error('Unexpected billing address. Please contact us.');
  window.location.assign(url);
}

export async function checkoutStatus(sessionId: string) {
  return invoke<{ status: string; payment_status: string; kind: string; plan?: string | null }>('stripe-checkout', { action: 'status', session_id: sessionId });
}

/** Stripe's checkout in a dialog over the page. */
export function CheckoutDialog({ stripeKey, request, title, onClose }: { stripeKey: string; request: CheckoutRequest; title: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);

  const fetchClientSecret = useCallback(async () => {
    const r = await invoke<{ client_secret: string }>('stripe-checkout', { action: 'start', ...request });
    return r.client_secret;
  }, [request]);

  useEffect(() => {
    let page: EmbeddedPage | null = null;
    let gone = false;
    (async () => {
      try {
        await loadStripeJs();
        if (!window.Stripe) throw new Error('The payment form did not load.');
        const created = await window.Stripe(stripeKey).createEmbeddedCheckoutPage({ fetchClientSecret });
        if (gone) { created.destroy(); return; }
        page = created;
        if (box.current) page.mount(box.current);
        setReady(true);
      } catch (e) {
        if (!gone) setErr(e instanceof Error ? e.message : 'Could not start the payment.');
      }
    })();
    return () => { gone = true; page?.destroy(); };
  }, [stripeKey, fetchClientSecret]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,57,84,0.55)', zIndex: 50, overflowY: 'auto', padding: '24px 16px' }}>
      <div className="card" style={{ maxWidth: 560, margin: '0 auto', position: 'relative' }}>
        <div className="row spread" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="ghost" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </div>
        {!ready && !err && <p className="muted">Loading the secure payment form...</p>}
        {err && <Msg kind="err">{err}</Msg>}
        <div ref={box} />
        <p className="muted small" style={{ marginTop: 10 }}>Payments are handled by Stripe. WhileIn never sees your card number.</p>
      </div>
    </div>
  );
}

/** After Stripe sends the business back (?checkout=cs_...), waits for the webhook to switch things on. */
export function useCheckoutReturn(onPaid: () => void) {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('checkout');
    if (!sid || !/^cs_[A-Za-z0-9_]+$/.test(sid)) return;
    window.history.replaceState(null, '', window.location.pathname);
    let timer = 0;
    const check = async () => {
      try {
        const s = await checkoutStatus(sid);
        if (s.status === 'complete') {
          setMsg({ kind: 'ok', text: s.kind === 'push' ? 'Payment received. Your push is paid and scheduled once the deal is approved.' : 'Payment received. Your plan is being switched on.' });
          onPaid();
          // The webhook usually lands within seconds; refresh a few times.
          let n = 0;
          timer = window.setInterval(() => { onPaid(); if (++n >= 8) window.clearInterval(timer); }, 3000);
        } else if (s.status === 'open') {
          setMsg({ kind: 'err', text: 'The payment was not finished. You have not been charged. You can try again.' });
        } else {
          setMsg({ kind: 'err', text: 'That checkout expired. You have not been charged.' });
        }
      } catch (e) {
        setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not check the payment.' });
      }
    };
    check();
    return () => window.clearInterval(timer);
  }, [onPaid]);
  return msg;
}

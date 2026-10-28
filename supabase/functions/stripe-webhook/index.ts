// Supabase Edge Function: stripe-webhook  (W13 and W14)
//
// Stripe calls this after payments and subscription changes. It is the only
// place a paid plan or push is turned on, renewed or ended. Every call is
// checked against the webhook signing secret, and each event is handled once.
//
// Events to send from Stripe (Workbench > Webhooks > Add destination):
//   checkout.session.completed, checkout.session.expired,
//   customer.subscription.updated, customer.subscription.deleted,
//   invoice.paid, invoice.payment_failed
// Endpoint URL: https://ugeawvndcngviriaeyle.supabase.co/functions/v1/stripe-webhook
// API version for the endpoint: 2026-08-26.dahlia (same as _shared/stripe.ts)
//
// Deploy:  npx supabase functions deploy stripe-webhook --no-verify-jwt
//          (Stripe cannot send a Supabase sign-in; the signature check replaces it)
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (whsec_...)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { invoiceSubscription, periodEnd, stripe, verifyStripeSignature } from '../_shared/stripe.ts';

const ok = () => new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 });
  const raw = await req.text();
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  if (!(await verifyStripeSignature(raw, req.headers.get('Stripe-Signature'), secret))) {
    return new Response('Bad signature', { status: 400 });
  }
  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response('Bad body', { status: 400 }); }

  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };

  const { data: fresh, error: seenErr } = await db.rpc('service_stripe_event_new', { p_id: event.id, p_type: event.type });
  if (seenErr) return new Response('Database error', { status: 500 });
  if (fresh === false) return ok(); // already handled

  // Applies a subscription's current state from Stripe (always re-read, so the
  // order events arrive in does not matter).
  async function applySubscription(subId: string, holdId: string | null) {
    const sub = await stripe('GET', `subscriptions/${subId}`);
    const m = sub.metadata ?? {};
    if (!m.listing_id || !m.plan) {
      console.log('subscription without in30A metadata, ignored', subId);
      return;
    }
    const end = periodEnd(sub);
    const oldSub = await call('service_apply_subscription', {
      p_sub: sub.id, p_listing: m.listing_id, p_customer: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
      p_plan: m.plan, p_billing: m.billing || 'month', p_founding: m.founding === 'true',
      p_status: sub.status, p_period_end: end ? new Date(end * 1000).toISOString() : null,
      p_cancel_at_end: Boolean(sub.cancel_at_period_end || sub.cancel_at), p_hold: holdId,
    });
    // The business switched plans: end the old subscription now, with a
    // prorated credit for the unused time.
    if (typeof oldSub === 'string' && oldSub) {
      try {
        await stripe('DELETE', `subscriptions/${oldSub}`, { prorate: true });
      } catch (e) {
        console.error('could not cancel the old subscription', oldSub, e instanceof Error ? e.message : e);
      }
    }
  }

  try {
    const o = event.data?.object ?? {};
    switch (event.type) {
      case 'checkout.session.completed': {
        const m = o.metadata ?? {};
        if (o.mode === 'subscription' && o.subscription) {
          await applySubscription(typeof o.subscription === 'string' ? o.subscription : o.subscription.id, m.hold_id || null);
        } else if (o.mode === 'payment' && m.kind === 'push' && m.deal_id && o.payment_status === 'paid') {
          await call('service_push_paid', {
            p_deal: m.deal_id, p_hold: m.hold_id || null,
            p_customer: typeof o.customer === 'string' ? o.customer : o.customer?.id ?? null,
          });
        }
        break;
      }
      case 'checkout.session.expired': {
        if (o.metadata?.hold_id) await call('service_release_hold', { p_hold: o.metadata.hold_id });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await applySubscription(o.id, null);
        break;
      }
      case 'invoice.paid': {
        const sid = invoiceSubscription(o);
        if (sid) await applySubscription(sid, null);
        break;
      }
      case 'invoice.payment_failed': {
        const sid = invoiceSubscription(o);
        if (sid) await call('service_payment_failed', { p_sub: sid });
        break;
      }
      default:
        break;
    }
    return ok();
  } catch (e) {
    console.error('stripe-webhook', event.type, event.id, e instanceof Error ? e.message : e);
    // Let Stripe retry this event later.
    await db.rpc('service_stripe_event_forget', { p_id: event.id });
    return new Response('Handler error', { status: 500 });
  }
});

// Supabase Edge Function: stripe-checkout  (W13 plans, W14 add-on slots, paid pushes)
//
// Starts a Stripe embedded checkout for a signed-in business owner, or reports a
// finished checkout's status for the return page. The rules (owner, free slot,
// Founding place, push still payable) are checked in the database as that user
// by portal_checkout_prepare(), which also holds the slot for 35 minutes.
// The plan or push is only turned on by stripe-webhook, never from here.
//
// POST JSON (signed in):
//   { action: 'start', kind: 'plan', listing_id, plan, billing }
//   { action: 'start', kind: 'push', listing_id, deal_id }
//   { action: 'status', session_id }
//
// Deploy:  npx supabase functions deploy stripe-checkout
// Secrets: STRIPE_SECRET_KEY (sk_test_... first, sk_live_... at launch), PORTAL_URL,
//          optional PORTAL_EXTRA_ORIGINS (comma list, for example the temporary portal address)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { cors, portalUrl, reply, stripe, StripeError } from '../_shared/stripe.ts';

function returnBase(req: Request): string {
  const allowed = [portalUrl(), ...(Deno.env.get('PORTAL_EXTRA_ORIGINS') ?? '').split(',')]
    .map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const origin = (req.headers.get('Origin') ?? '').replace(/\/+$/, '');
  return allowed.includes(origin) ? origin : portalUrl();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return reply({ error: 'Please sign in again' }, 401);
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  let body: Record<string, string | undefined> = {};
  try { body = await req.json(); } catch { return reply({ error: 'Bad request' }, 400); }

  try {
    if (body.action === 'status') {
      const sid = String(body.session_id ?? '');
      if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) return reply({ error: 'Bad session' }, 400);
      const { data: hold, error } = await asUser.rpc('portal_checkout_hold', { p_session: sid });
      if (error) return reply({ error: 'Not found' }, 404);
      const s = await stripe('GET', `checkout/sessions/${sid}`);
      return reply({ status: s.status, payment_status: s.payment_status, ...(hold as Record<string, unknown>) });
    }

    if (body.action !== 'start') return reply({ error: 'Unknown action' }, 400);
    if (!Deno.env.get('STRIPE_SECRET_KEY')) return reply({ error: 'Online payments are not switched on yet. Use the request button instead.' }, 503);

    const { data: prep, error } = await asUser.rpc('portal_checkout_prepare', {
      p_kind: body.kind, p_listing_id: body.listing_id, p_plan: body.plan ?? null,
      p_billing: body.billing ?? null, p_deal_id: body.deal_id ?? null,
    });
    if (error) return reply({ error: error.message }, 400);
    const p = prep as {
      hold_id: string; price_key: string; mode: 'subscription' | 'payment'; founding: boolean; customer: string | null;
      email: string | null; listing_id: string; listing_name: string; plan: string | null; billing: string | null; deal_id: string | null;
    };

    const { data: setting } = await service.from('app_settings').select('value').eq('key', 'stripe_prices').maybeSingle();
    const price = (setting?.value as Record<string, string> | null)?.[p.price_key];
    if (!price) {
      await service.rpc('service_release_hold', { p_hold: p.hold_id });
      return reply({ error: 'This option is not set up for online payment yet. Use the request button instead.' }, 503);
    }

    const meta = {
      kind: p.mode === 'subscription' ? 'plan' : 'push',
      listing_id: p.listing_id, hold_id: p.hold_id,
      plan: p.plan ?? '', billing: p.billing ?? '', founding: String(p.founding), deal_id: p.deal_id ?? '',
    };
    const base = returnBase(req);
    const page = p.mode === 'subscription' ? 'plan' : 'deals';
    const params: Record<string, unknown> = {
      ui_mode: 'embedded_page',
      mode: p.mode,
      line_items: [{ price, quantity: 1 }],
      return_url: `${base}/${page}?checkout={CHECKOUT_SESSION_ID}`,
      client_reference_id: p.listing_id,
      metadata: meta,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    };
    if (p.customer) params.customer = p.customer;
    else if (p.email) params.customer_email = p.email;
    if (p.mode === 'subscription') {
      params.subscription_data = { metadata: meta, description: `in30A ${p.plan} plan for ${p.listing_name}`.slice(0, 500) };
    } else {
      if (!p.customer) params.customer_creation = 'always';
      params.payment_intent_data = { metadata: meta, description: `in30A push for ${p.listing_name}`.slice(0, 500) };
    }

    const session = await stripe('POST', 'checkout/sessions', params);
    await service.rpc('service_checkout_attach', { p_hold: p.hold_id, p_session: session.id });
    return reply({ client_secret: session.client_secret, session_id: session.id });
  } catch (e) {
    const msg = e instanceof StripeError ? e.message : 'Something went wrong. Please try again.';
    console.error('stripe-checkout', e instanceof Error ? e.message : e);
    return reply({ error: msg }, e instanceof StripeError && e.status < 500 ? 400 : 502);
  }
});

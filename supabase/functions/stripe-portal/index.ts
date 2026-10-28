// Supabase Edge Function: stripe-portal  (W13 "Manage billing")
//
// Opens Stripe's customer portal for a business owner: card, invoices and
// cancelling. Plan changes are made from the Plan page instead, so the slot
// limits always apply (switch plan changes off in the Stripe portal settings).
//
// POST JSON (signed in): { listing_id }
//
// Deploy:  npx supabase functions deploy stripe-portal
// Secrets: STRIPE_SECRET_KEY, PORTAL_URL, optional PORTAL_EXTRA_ORIGINS

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { cors, portalUrl, reply, stripe, StripeError } from '../_shared/stripe.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return reply({ error: 'Please sign in again' }, 401);

  let listingId = '';
  try { listingId = String((await req.json())?.listing_id ?? ''); } catch { /* checked below */ }
  if (!/^[0-9a-f-]{36}$/.test(listingId)) return reply({ error: 'Bad request' }, 400);

  // Owner check, as the user.
  const { error: notOwner } = await asUser.rpc('portal_billing_status', { p_listing_id: listingId });
  if (notOwner) return reply({ error: 'Not allowed' }, 403);

  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data: customer } = await service.rpc('service_listing_customer', { p_listing: listingId });
  if (!customer) return reply({ error: 'There is no billing account yet. It is created with your first payment.' }, 404);

  const allowed = [portalUrl(), ...(Deno.env.get('PORTAL_EXTRA_ORIGINS') ?? '').split(',')].map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  const origin = (req.headers.get('Origin') ?? '').replace(/\/+$/, '');
  const base = allowed.includes(origin) ? origin : portalUrl();

  try {
    const s = await stripe('POST', 'billing_portal/sessions', { customer, return_url: `${base}/plan` });
    return reply({ url: s.url });
  } catch (e) {
    console.error('stripe-portal', e instanceof Error ? e.message : e);
    return reply({ error: e instanceof StripeError ? e.message : 'Could not open billing. Please try again.' }, 502);
  }
});

// Supabase Edge Function: admin-send-push
//
// Lets an admin send a push from the Business Portal. Only signed-in admins
// can use it: the caller's login token is checked against profiles.is_admin.
//
// Body: { title, body, audience: 'deals' | 'all', listing_id?, dry? }
//   audience 'deals'  people with Deal alerts on. The title gets "Sponsored ·".
//   audience 'all'    everyone with notifications on (announcements).
//   dry: true         only returns how many people would receive it.
// At most 3 broadcasts per hour, so a slip or a stolen login cannot spam.
//
// Optional secret ALLOWED_ORIGINS (comma separated) for browser access.
// Deploy:  supabase functions deploy admin-send-push

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const DEFAULT_ORIGINS = ['https://portal.in30a.app', 'https://in30a-49306.web.app', 'http://localhost:5173'];

function corsFor(req: Request) {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_ORIGINS;
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': list.includes(origin) ? origin : list[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}

serve(async (req) => {
  const cors = corsFor(req);
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
  const { data: userData } = await admin.auth.getUser(jwt);
  const userId = userData?.user?.id;
  if (!userId) return reply({ error: 'Not allowed' }, 401);
  const { data: prof } = await admin.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  if (!prof?.is_admin) return reply({ error: 'Not allowed' }, 403);

  let input: any;
  try { input = await req.json(); } catch { return reply({ error: 'Bad request' }, 400); }
  const audience = input.audience === 'all' ? 'all' : 'deals';
  const rawTitle = String(input.title ?? '').trim();
  const body = String(input.body ?? '').trim().slice(0, 178);
  const listingId = typeof input.listing_id === 'string' && /^[0-9a-f-]{36}$/i.test(input.listing_id) ? input.listing_id : null;
  if (rawTitle.length < 3 || rawTitle.length > 50 || body.length < 3) {
    return reply({ error: 'Title must be 3 to 50 characters and the message at least 3' }, 400);
  }
  const title = audience === 'deals' ? `Sponsored · ${rawTitle}` : rawTitle;

  let q = admin.from('profiles').select('push_token').eq('notifications_enabled', true).not('push_token', 'is', null);
  if (audience === 'deals') q = q.eq('deal_alerts_enabled', true);
  const { data: rows, error } = await q;
  if (error) return reply({ error: 'Could not read recipients' }, 500);
  const tokens = Array.from(new Set((rows ?? []).map((r: { push_token: string }) => r.push_token)));

  if (input.dry) return reply({ dry: true, recipients: tokens.length, title });

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('push_log').select('id', { count: 'exact', head: true })
    .eq('kind', 'broadcast').gt('created_at', since);
  if ((count ?? 0) >= 3) return reply({ error: 'Limit reached: 3 broadcasts per hour' }, 429);

  let delivered = 0;
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100);
    const messages = chunk.map((to) => ({
      to, title, body, sound: 'default',
      data: { type: audience === 'deals' ? 'deal' : 'announcement', sponsored: audience === 'deals', listing_id: listingId },
    }));
    try {
      const res = await fetch(EXPO_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      const out = await res.json();
      const tickets: Array<{ status: string; details?: { error?: string } }> = out?.data ?? [];
      for (let j = 0; j < tickets.length; j++) {
        if (tickets[j].status === 'ok') delivered++;
        else if (tickets[j].details?.error === 'DeviceNotRegistered') {
          await admin.from('profiles').update({ push_token: null }).eq('push_token', chunk[j]);
        }
      }
    } catch {
      // Keep going.
    }
  }

  await admin.from('push_log').insert({
    kind: 'broadcast', listing_id: listingId, title, body, audience, recipients: delivered, sent_by: userId,
  });
  return reply({ sent: delivered, recipients: tokens.length });
});

// Supabase Edge Function: send-scheduled-pushes
//
// Sends the sponsored deal pushes that businesses booked in the portal.
// It replaces notify-new-deal. Schedule it every 15 minutes:
//   Supabase Dashboard > Edge Functions > send-scheduled-pushes > Cron
//   (or Integrations > Cron), schedule "*/15 * * * *".
//
// A push is due when its booked day and window time has arrived (the send
// hour for each window is in app_settings > push_windows, Central Time). The
// database decides what is due, so running this more often never double sends:
// a deal moves to "sent" the moment its push goes out.
//
// Security: the caller must send the header  x-cron-secret: <CRON_SECRET>.
// Set it with:  supabase secrets set CRON_SECRET=...
// Test without sending anything: add  ?dry=1  to the URL.
//
// Deploy:  supabase functions deploy send-scheduled-pushes

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return json({ error: 'Not allowed' }, 401);
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const { data: due, error } = await admin.rpc('due_scheduled_pushes');
  if (error) return json({ error: 'Could not read due pushes', detail: error.message }, 500);

  const results: unknown[] = [];

  for (const deal of due ?? []) {
    const isNearby = deal.push_type === 'nearby';
    const { data: rows, error: rErr } = await admin.rpc('deal_push_recipients', {
      p_listing_id: deal.listing_id,
      p_nearby: isNearby,
    });
    if (rErr) {
      results.push({ deal: deal.deal_id, error: rErr.message });
      continue;
    }
    const tokens: string[] = Array.from(new Set((rows ?? []).map((r: { push_token: string }) => r.push_token)));

    const title = `Sponsored · ${deal.listing_name}`.slice(0, 65);
    const body = `${deal.title}${deal.discount_text ? `: ${deal.discount_text}` : ''}`.slice(0, 178);

    if (dry) {
      results.push({ deal: deal.deal_id, type: deal.push_type, recipients: tokens.length, title, body });
      continue;
    }

    let delivered = 0;
    for (let i = 0; i < tokens.length; i += 100) {
      const chunk = tokens.slice(i, i + 100);
      const messages = chunk.map((to) => ({
        to,
        title,
        body,
        sound: 'default',
        data: { type: 'deal', sponsored: true, listing_id: deal.listing_id, deal_id: deal.deal_id },
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
            // The app was removed. Forget the token so it is not tried again.
            await admin.from('profiles').update({ push_token: null }).eq('push_token', chunk[j]);
          }
        }
      } catch {
        // One failed batch must not stop the rest.
      }
    }

    await admin.rpc('mark_push_sent', { p_deal_id: deal.deal_id, p_recipients: delivered, p_title: title, p_body: body });
    results.push({ deal: deal.deal_id, type: deal.push_type, recipients: delivered });
  }

  return json({ dry, due: (due ?? []).length, results });
});

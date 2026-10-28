// Supabase Edge Function: geocode-address
//
// Admin-only. Turns a street address into a map pin so the Review queue and
// Admin > Missing details can set a pin. Looks at the address only (not the
// business name) and accepts a result only inside a box around 30A.
//
// A17: uses Mapbox's PERMANENT geocoding (the pin is stored, and only permanent
// results may be stored). Google is no longer used here.
//
// Deploy:  npx supabase functions deploy geocode-address
// Secret:  MAPBOX_GEOCODING_TOKEN  (type it in your own terminal, never in chat:
//          npx supabase secrets set MAPBOX_GEOCODING_TOKEN=...)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const BOX = { south: 30.25, north: 30.4, west: -86.31, east: -85.98 };
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization') ?? '';
  const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: auth } },
  });
  const { data: isAdmin } = await supa.rpc('is_portal_admin');
  if (isAdmin !== true) return out({ error: 'Not allowed' }, 403);

  const token = Deno.env.get('MAPBOX_GEOCODING_TOKEN');
  if (!token) return out({ error: 'MAPBOX_GEOCODING_TOKEN is not set on this function' }, 500);

  let address = '';
  try {
    address = String((await req.json())?.address ?? '').trim().slice(0, 200);
  } catch {
    // fall through
  }
  if (address.length < 6) return out({ error: 'Enter a street address first' }, 400);

  const params = new URLSearchParams({
    q: address.replace(/;/g, ','),
    access_token: token,
    permanent: 'true',
    autocomplete: 'false',
    country: 'us',
    types: 'address',
    limit: '1',
    bbox: `${BOX.west},${BOX.south},${BOX.east},${BOX.north}`,
    proximity: '-86.15,30.32',
  });
  const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`);
  if (!res.ok) return out({ error: `Mapbox answered ${res.status}` }, 502);
  const f = (await res.json()).features?.[0];
  const [lng, lat] = f?.geometry?.coordinates ?? [];
  if (typeof lat !== 'number' || typeof lng !== 'number') return out({ error: 'Address not found' }, 404);
  const formatted = String(f.properties?.full_address ?? '').replace(/, United States$/, '');
  if (lat < BOX.south || lat > BOX.north || lng < BOX.west || lng > BOX.east) {
    return out({ error: `That address is outside the 30A area (${formatted})` }, 422);
  }
  const confidence = f.properties?.match_code?.confidence ?? 'unknown';
  return out({ lat, lng, formatted, confidence });
});

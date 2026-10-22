// Supabase Edge Function: geocode-address
//
// Admin-only. Turns a street address into a map pin so the Review queue can
// fill the pin before a business is approved. Looks at the address only (not the
// business name) and accepts a result only inside a box around 30A.
//
// Deploy:  supabase functions deploy geocode-address
// Secret:  GOOGLE_PLACES_API_KEY  (already set for the import script? set it here too:
//          supabase secrets set GOOGLE_PLACES_API_KEY=...)

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

  const key = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!key) return out({ error: 'GOOGLE_PLACES_API_KEY is not set on this function' }, 500);

  let address = '';
  try {
    address = String((await req.json())?.address ?? '').trim().slice(0, 200);
  } catch {
    // fall through
  }
  if (address.length < 6) return out({ error: 'Enter a street address first' }, 400);

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.location,places.formattedAddress', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      textQuery: address,
      maxResultCount: 1,
      locationBias: { rectangle: { low: { latitude: BOX.south, longitude: BOX.west }, high: { latitude: BOX.north, longitude: BOX.east } } },
    }),
  });
  if (!res.ok) return out({ error: `Google answered ${res.status}` }, 502);
  const place = (await res.json()).places?.[0];
  const loc = place?.location;
  if (!loc) return out({ error: 'Address not found' }, 404);
  if (loc.latitude < BOX.south || loc.latitude > BOX.north || loc.longitude < BOX.west || loc.longitude > BOX.east) {
    return out({ error: `That address is outside the 30A area (${place.formattedAddress ?? ''})` }, 422);
  }
  return out({ lat: loc.latitude, lng: loc.longitude, formatted: place.formattedAddress ?? '' });
});

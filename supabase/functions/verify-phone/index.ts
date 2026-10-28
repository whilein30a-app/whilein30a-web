// Supabase Edge Function: verify-phone
//
// Confirms a reviewer's phone number with a one-time text code through Twilio
// Verify (Trello A43). Reviews need a confirmed number so every review is tied
// to a real person; one number per account.
//
// Actions (POST JSON, signed-in user):
//   { action: 'start', phone, channel? }   channel: 'sms' (default) | 'call'
//   { action: 'check', phone, code }
//
// Deploy:  npx supabase functions deploy verify-phone
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
//          (the same three as verify-ownership; set once for the project)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

const MAX_STARTS = 5; // codes per account per 24 hours
const MAX_CHECKS = 8; // tries per account per 24 hours

// Accepts "+63 917 123 4567" or a US number without the +1.
function e164(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : null;
  if (/^1[2-9]\d{9}$/.test(digits)) return '+' + digits;
  if (/^[2-9]\d{9}$/.test(digits)) return '+1' + digits;
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return out({ error: 'Use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: u } = await asUser.auth.getUser();
  const user = u?.user;
  if (!user) return out({ error: 'signin' }, 401);

  let body: { action?: string; phone?: string; code?: string; channel?: string } = {};
  try {
    body = await req.json();
  } catch {
    return out({ error: 'bad_request' }, 400);
  }

  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const service = Deno.env.get('TWILIO_VERIFY_SERVICE_SID');
  if (!sid || !token || !service) return out({ error: 'not_configured' });

  const to = e164(body.phone);
  if (!to) return out({ error: 'bad_phone' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const count = async (kind: 'start' | 'check') => {
    const { count: n } = await admin
      .from('phone_verify_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('kind', kind)
      .gte('created_at', since);
    return n ?? 0;
  };
  const twilio = (path: string, form: Record<string, string>) =>
    fetch(`https://verify.twilio.com/v2/Services/${service}/${path}`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });

  // Same number already confirmed on another account.
  const { data: taken } = await admin
    .from('profiles')
    .select('id')
    .eq('phone_e164', to)
    .not('phone_verified_at', 'is', null)
    .neq('id', user.id)
    .limit(1);
  if (taken && taken.length) return out({ error: 'phone_in_use' });

  if (body.action === 'start') {
    if ((await count('start')) >= MAX_STARTS) return out({ error: 'too_many' });
    await admin.from('phone_verify_attempts').insert({ user_id: user.id, kind: 'start' });
    const res = await twilio('Verifications', { To: to, Channel: body.channel === 'call' ? 'call' : 'sms' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      console.error('twilio start failed', res.status, j?.code, j?.message);
      if (j?.code === 60203) return out({ error: 'too_many' });
      if (j?.code === 60200 || j?.code === 21211 || j?.code === 21614) return out({ error: 'bad_phone' });
      return out({ error: 'send_failed' });
    }
    return out({ sent: true, last4: to.slice(-4) });
  }

  if (body.action === 'check') {
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (code.length < 4 || code.length > 10) return out({ error: 'bad_code' });
    if ((await count('check')) >= MAX_CHECKS) return out({ error: 'too_many' });
    await admin.from('phone_verify_attempts').insert({ user_id: user.id, kind: 'check' });
    const res = await twilio('VerificationCheck', { To: to, Code: code });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('twilio check failed', res.status, j?.code, j?.message);
      return out({ error: j?.code === 20404 ? 'expired' : 'check_failed' });
    }
    if (j?.status !== 'approved') return out({ verified: false });
    const { data: result, error } = await admin.rpc('service_mark_phone_verified', { p_user: user.id, p_phone: to });
    if (error) {
      console.error('mark verified failed', error.message);
      return out({ error: 'save_failed' });
    }
    if (result !== 'verified') return out({ error: String(result) });
    return out({ verified: true, last4: to.slice(-4) });
  }

  return out({ error: 'unknown_action' }, 400);
});

// Supabase Edge Function: send-sponsor-report
//
// Emails each business a monthly summary of what their listing earned in the
// app, built from the nightly daily totals (listing_stats_daily), so the
// numbers match the Business Portal exactly.
//
//   Sponsors   full report: visitor taps, views, best day, top source,
//              change against the month before, one tip.
//   Free Basic short version with a nudge to upgrade.
//
// Deploy:   supabase functions deploy send-sponsor-report
// Secrets:  RESEND_API_KEY   (the in30a.app domain must be verified in Resend)
//           PORTAL_URL       (default https://portal.in30a.app)
//           CRON_SECRET      (a long random string; the schedule sends it)
//
// Schedule on the 1st at 14:07 UTC (morning in Central Time):
//   select cron.schedule('send-sponsor-report', '7 14 1 * *', $$
//     select net.http_post(
//       url := 'https://<project>.supabase.co/functions/v1/send-sponsor-report',
//       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>')
//     ) $$);
//
// Try it first: call with {"dryRun": true}. It returns what it would send, to
// whom, and sends nothing. Without RESEND_API_KEY it is always a dry run.
//
// What it will not do:
//   * invent or pad numbers. A quiet month is reported as quiet, or skipped.
//   * email a listing with fewer than MIN_TAPS_VIEWS events in total.
//   * email an owner who switched report emails off in the portal.
//   * run for anyone who does not know the secret.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FROM = 'in30A <hello@in30a.app>';
const MIN_EVENTS = 5;
const ADDRESS = 'Visit Like a Local LLC d/b/a in30A, 1821 N Lake Forest Dr, Ste 700 #123, McKinney, TX 75071';

const jsonHeaders = { 'Content-Type': 'application/json' };

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The month that just ended, in Central Time.
function monthWindow(now: Date) {
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const first = new Date(Date.UTC(central.getFullYear(), central.getMonth(), 1));
  const prevFirst = new Date(Date.UTC(central.getFullYear(), central.getMonth() - 1, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFirst), to: iso(first), label: prevFirst.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}

function change(cur: number, prev: number): string {
  if (prev <= 0) return cur > 0 ? 'First full month of data' : '';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return 'Same as the month before';
  return `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% on the month before`;
}

const SOURCE_NAMES: Record<string, string> = {
  home: 'the Home screen', featured: 'a featured slot', category: 'category lists', map: 'the map',
  search: 'search', deal: 'deals', ai: 'the AI Concierge', push: 'push notifications',
  area: 'area guides', favorites: 'saved places', photo_wall: 'the Photo Wall', direct: 'direct visits',
};

function tipFor(s: any): string {
  const byKind = s.by_kind ?? {};
  const views = Number(byKind.detail_view ?? 0);
  const calls = Number(byKind.call ?? 0);
  const web = Number(byKind.website ?? 0);
  const dirs = Number(byKind.directions ?? 0);
  if (views >= 20 && calls + web + dirs < views * 0.15) {
    return 'Many people opened your listing but few tapped through. A fresh photo and a clear one line description in the portal can help.';
  }
  if (Number(byKind.deal_view ?? 0) === 0) {
    return 'Listings with a deal get noticed more. You can add one in the portal in a minute.';
  }
  return 'Keep your hours, phone and website current in the portal so every tap goes somewhere useful.';
}

function layout(title: string, bodyHtml: string, portal: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f8f8;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d2b2a;">
<div style="max-width:34rem;margin:0 auto;padding:32px 20px;">
  <p style="margin:0 0 4px;font-size:.85rem;color:#5c6b6a;letter-spacing:.04em;text-transform:uppercase;">in30A · ${esc(title)}</p>
  ${bodyHtml}
  <p style="margin:28px 0 0;font-size:.8rem;color:#5c6b6a;">Counts are real taps by visitors using the app. The same person tapping the same thing within 30 minutes counts once. We never see who anyone is.</p>
  <p style="margin:12px 0 0;font-size:.8rem;color:#5c6b6a;">Don't want these emails? <a href="${portal}/settings" style="color:#1f6f63;">Turn them off in the portal</a>.<br>${esc(ADDRESS)}</p>
</div></body></html>`;
}

function fullEmail(name: string, label: string, s: any, portal: string) {
  const taps = Number(s.taps), views = Number(s.views);
  const src = s.top_source ? SOURCE_NAMES[s.top_source] ?? s.top_source : null;
  const best = s.best_day
    ? new Date(s.best_day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : null;
  const row = (k: string, v: string) =>
    `<tr><td style="padding:8px 0;color:#5c6b6a;">${k}</td><td style="padding:8px 0;text-align:right;font-weight:600;">${v}</td></tr>`;
  const body = `
  <h1 style="margin:0 0 6px;font-size:1.35rem;">${esc(name)}</h1>
  <p style="margin:0 0 18px;color:#5c6b6a;">Your ${esc(label)} results.</p>
  <p style="margin:0;font-size:2.2rem;font-weight:700;line-height:1.1;">${taps}</p>
  <p style="margin:0 0 4px;color:#5c6b6a;">visitor taps (calls, directions, website and deal taps)</p>
  <p style="margin:0 0 18px;color:#1f6f63;font-size:.9rem;">${esc(change(taps, Number(s.prev_taps)))}</p>
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #dfe6e5;border-bottom:1px solid #dfe6e5;">
    ${row('Times your listing was opened', String(views))}
    ${best ? row('Best day', esc(best)) : ''}
    ${src ? row('Top source of taps', esc(src)) : ''}
  </table>
  <p style="margin:18px 0 0;"><strong>Tip:</strong> ${esc(tipFor(s))}</p>
  <p style="margin:22px 0 0;"><a href="${portal}" style="background:#0B3954;color:#fff;text-decoration:none;padding:10px 18px;border-radius:20px;display:inline-block;">See the full dashboard</a></p>`;
  return layout(label, body, portal);
}

function shortEmail(name: string, label: string, s: any, portal: string) {
  const body = `
  <h1 style="margin:0 0 6px;font-size:1.35rem;">${esc(name)}</h1>
  <p style="margin:0 0 14px;color:#5c6b6a;">In ${esc(label)}, your listing was opened ${Number(s.views)} times and got ${Number(s.taps)} visitor taps.</p>
  <p style="margin:0;">Sponsored listings get the full breakdown: best day, top source, month on month change and a monthly tip, plus a featured spot in the app.</p>
  <p style="margin:22px 0 0;"><a href="${portal}" style="background:#0B3954;color:#fff;text-decoration:none;padding:10px 18px;border-radius:20px;display:inline-block;">See your dashboard</a></p>`;
  return layout(label, body, portal);
}

serve(async (req) => {
  // Only the schedule (or someone holding the secret) may run this.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response(JSON.stringify({ error: 'Not allowed' }), { status: 401, headers: jsonHeaders });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const portal = (Deno.env.get('PORTAL_URL') ?? 'https://portal.in30a.app').replace(/\/$/, '');

  let dryRun = false;
  try {
    dryRun = (await req.json())?.dryRun === true;
  } catch {
    // No body is the normal scheduled case.
  }
  if (!resendKey) dryRun = true;

  const { from, to, label } = monthWindow(new Date());

  // Everyone who should get one: sponsors with a report_email, plus owners
  // of any listing who have report emails switched on.
  type Target = { listingId: string; name: string; email: string; sponsored: boolean };
  const targets: Target[] = [];

  const { data: sponsors } = await admin
    .from('listings').select('id, name, report_email').eq('is_sponsored', true).not('report_email', 'is', null);
  for (const l of sponsors ?? []) targets.push({ listingId: l.id, name: l.name, email: l.report_email, sponsored: true });

  const { data: owners } = await admin
    .from('listing_owners').select('user_id, listing_id, listings(name, is_sponsored)').eq('email_reports', true);
  for (const o of (owners ?? []) as any[]) {
    const { data: u } = await admin.auth.admin.getUserById(o.user_id);
    const email = u?.user?.email;
    if (!email || !o.listings) continue;
    if (targets.some((t) => t.listingId === o.listing_id && t.email.toLowerCase() === email.toLowerCase())) continue;
    targets.push({ listingId: o.listing_id, name: o.listings.name, email, sponsored: !!o.listings.is_sponsored });
  }

  const sent: any[] = [];
  const skipped: any[] = [];

  for (const t of targets) {
    const { data: summary, error } = await admin.rpc('engagement_month_summary', {
      p_listing_id: t.listingId, p_from: from, p_to: to,
    });
    if (error || !summary) {
      skipped.push({ name: t.name, reason: error?.message ?? 'no data' });
      continue;
    }
    const total = Number(summary.taps) + Number(summary.views);
    if (total < MIN_EVENTS) {
      skipped.push({ name: t.name, reason: `only ${total} events, below ${MIN_EVENTS}` });
      continue;
    }
    const html = t.sponsored ? fullEmail(t.name, label, summary, portal) : shortEmail(t.name, label, summary, portal);

    if (dryRun) {
      sent.push({ name: t.name, to: t.email, sponsored: t.sponsored, taps: summary.taps, views: summary.views, dryRun: true });
      continue;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [t.email],
        subject: `Your in30A results for ${label}`,
        html,
        headers: { 'List-Unsubscribe': `<${portal}/settings>` },
      }),
    });
    if (!res.ok) {
      skipped.push({ name: t.name, reason: `email failed: ${res.status}` });
      continue;
    }
    sent.push({ name: t.name, to: t.email, sponsored: t.sponsored });
  }

  console.log('send-sponsor-report:', JSON.stringify({ month: label, dryRun, sent: sent.length, skipped: skipped.length }));
  return new Response(JSON.stringify({ month: label, dryRun, sent, skipped }), { headers: jsonHeaders });
});

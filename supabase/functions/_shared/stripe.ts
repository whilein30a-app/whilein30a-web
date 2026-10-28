// Shared Stripe helpers for stripe-checkout, stripe-portal and stripe-webhook.
//
// Plain REST calls (no SDK), pinned to one API version so a Stripe change on
// the account can never change what these functions send or receive. The
// webhook endpoint in Stripe should use the same version (see README_WEB_130).

export const STRIPE_API_VERSION = '2026-08-26.dahlia';

type Params = Record<string, unknown>;

// Stripe's form encoding: a[b][0][c]=v
export function formEncode(params: Params, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') out.push(...formEncode(item as Params, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      out.push(...formEncode(v as Params, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

export class StripeError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function stripe(method: 'GET' | 'POST' | 'DELETE', path: string, params: Params = {}): Promise<any> {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new StripeError(500, 'not_configured', 'Payments are not switched on yet');
  const body = formEncode(params).join('&');
  const inQuery = method === 'GET' || method === 'DELETE';
  const url = `https://api.stripe.com/v1/${path}${inQuery && body ? `?${body}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': STRIPE_API_VERSION,
      ...(!inQuery ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: !inQuery && body ? body : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new StripeError(res.status, json?.error?.code ?? 'stripe_error', json?.error?.message ?? `Stripe answered ${res.status}`);
  }
  return json;
}

// Webhook signature: Stripe-Signature "t=...,v1=...". HMAC-SHA256 of "t.body".
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${t}.${rawBody}`)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => s.length === hex.length && timingSafeEqual(s, hex));
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The period end moved from the subscription to its items in 2025 (basil).
export function periodEnd(sub: any): number | null {
  return sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end ?? null;
}

// The subscription id on an invoice moved under parent in 2025 (basil).
export function invoiceSubscription(inv: any): string | null {
  const s = inv?.parent?.subscription_details?.subscription ?? inv?.subscription ?? null;
  return typeof s === 'string' ? s : s?.id ?? null;
}

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
export const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

export function portalUrl(): string {
  return (Deno.env.get('PORTAL_URL') ?? 'https://portal.in30a.app').replace(/\/+$/, '');
}

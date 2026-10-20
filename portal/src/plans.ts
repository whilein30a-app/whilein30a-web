import { useEffect, useState } from 'react';

import { supabase } from './supabase';

export type PlanId = 'basic' | 'premium' | 'featured' | 'spotlight';

export const PLAN_NAME: Record<PlanId, string> = { basic: 'Basic', premium: 'Premium', featured: 'Featured', spotlight: 'Spotlight' };

export const PLAN_BLURB: Record<PlanId, string[]> = {
  basic: ['Name, category, hours, address, map pin', 'Tap to call', '1 photo'],
  premium: ['Photo gallery and logo', 'Description, menu and booking links', 'Post deals and events', 'Ranks above free listings', 'Monthly stats'],
  featured: ['Everything in Premium', 'Top 3 in your subcategory', 'Featured badge and highlighted map pin', 'Limited to 3 per subcategory'],
  spotlight: ['Everything in Premium', 'Pinned #1 in your subcategory', '1 push notification per month', 'Limited to 1 per subcategory'],
};

// Dollars. Founding Partner prices are locked for 2 years, 20 places.
export const PRICES: Record<'founding' | 'standard', Record<Exclude<PlanId, 'basic'>, { month: number; year: number }>> = {
  founding: { premium: { month: 29, year: 290 }, featured: { month: 99, year: 990 }, spotlight: { month: 249, year: 2490 } },
  standard: { premium: { month: 49, year: 490 }, featured: { month: 149, year: 1490 }, spotlight: { month: 399, year: 3990 } },
};
export const PUSH_PRICE = { single: 99, nearby: 149 };

export const WINDOWS = {
  morning: 'Morning, 10 AM to 3 PM Central',
  afternoon: 'Afternoon, 3 to 8 PM Central',
} as const;

export const money = (n: number) => '$' + n.toLocaleString('en-US');

/** Today's date in Central Time as YYYY-MM-DD, the app's day. */
export function centralToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Reads one row of app_settings. Returns null until loaded or when missing. */
export function useSetting<T = any>(key: string): { value: T | null; reload: () => void; loaded: boolean } {
  const [value, setValue] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    supabase.from('app_settings').select('value').eq('key', key).maybeSingle().then(({ data }) => {
      if (!live) return;
      setValue((data?.value as T) ?? null);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [key, n]);
  return { value, reload: () => setN((x) => x + 1), loaded };
}

/** Adds the listing (or deal) id and email to a Stripe Payment Link so a payment can be matched in admin. */
export function payUrl(base: string | undefined, ref: string, email?: string | null): string | null {
  if (!base || !/^https:\/\//i.test(base)) return null;
  try {
    const u = new URL(base);
    u.searchParams.set('client_reference_id', ref);
    if (email) u.searchParams.set('prefilled_email', email);
    return u.toString();
  } catch {
    return null;
  }
}

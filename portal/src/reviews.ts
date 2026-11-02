// Shared by the QR card, the public rate page and admin (Trello A43).
import { supabase } from './supabase';

// The app's link scheme from app.json ("scheme"). If app.json says something
// else, change it here, rebuild and deploy.
export const APP_SCHEME = 'in30a';
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.whilein.app';

export const appRateLink = (listingId: string) => `${APP_SCHEME}://listing/${listingId}?rate=1`;

/** The web address a QR code points to. Admin can set the base in App settings. */
export async function rateUrl(listingId: string): Promise<string> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'reviews').maybeSingle();
  const base = String((data?.value as { rate_link_base?: string } | null)?.rate_link_base ?? '').trim().replace(/\/+$/, '');
  const root = /^https:\/\//i.test(base) ? base : `${window.location.origin}/rate`;
  return `${root}/${listingId}`;
}

export const MODERATION_RULES = [
  'Spam or advertising',
  'Off-topic or not about this place',
  'Hate, harassment or threats',
  'Personal information',
  'Conflict of interest (owner, staff, competitor)',
  'Not a genuine experience',
  'Illegal or explicit content',
] as const;

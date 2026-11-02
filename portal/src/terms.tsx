// Business Listing Terms (Trello A44). Agreement is required at every claim
// and every upload, and again once whenever the Terms version changes.
// Each agreement is stored with the date and the version by accept_terms()
// in sql/100; the version always comes from the server.
import { useEffect, useState, type ReactNode } from 'react';

import { Msg, errText } from './components';
import { useAuth } from './auth';
import { useListings } from './listings';
import { supabase } from './supabase';

export const TERMS_URL = 'https://whilein.app/terms';

export async function acceptBusinessTerms(context: 'claim' | 'upload' | 'reaccept', listingId?: string | null) {
  const { error } = await supabase.rpc('accept_terms', { p_kind: 'business', p_context: context, p_listing_id: listingId ?? null });
  return error ? errText(error) : null;
}

export function BusinessTermsCheck({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        I agree to the{' '}
        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">WhileIn Business Listing Terms</a>{' '}
        (section 7 of the Terms of Use).
      </span>
    </label>
  );
}

type Status = { version: string; signed_in: boolean; business_accepted?: boolean; manages_listing?: boolean };

// Shown in place of the page to anyone who manages a listing and has not
// agreed to the current version. If the status cannot be read, the portal
// carries on as normal rather than locking people out.
export function BusinessTermsGate({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { listings } = useListings();
  const [status, setStatus] = useState<Status | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!session) { setStatus(null); return; }
    let live = true;
    supabase.rpc('my_terms_status').then(({ data, error }) => {
      if (live) setStatus(error || !data ? null : (data as Status));
    });
    return () => { live = false; };
  }, [session, listings.length]);

  const needs = !!status && status.signed_in && status.manages_listing === true && status.business_accepted === false;
  if (!needs) return <>{children}</>;

  async function agree() {
    setErr('');
    if (!checked) return setErr('Tick the box to agree before you continue.');
    setBusy(true);
    const e = await acceptBusinessTerms('reaccept');
    setBusy(false);
    if (e) return setErr(e);
    setStatus((s) => (s ? { ...s, business_accepted: true } : s));
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h2 style={{ marginTop: 0 }}>We have updated our Business Listing Terms</h2>
      <p>
        Please read the updated <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">WhileIn Terms of Use</a>, in particular
        section 7, Business Listings. You need to agree once to keep managing your business in the portal.
      </p>
      <BusinessTermsCheck id="reaccept-terms" checked={checked} onChange={setChecked} />
      {err && <Msg kind="err">{err}</Msg>}
      <div style={{ marginTop: 16 }}>
        <button type="button" disabled={busy} onClick={agree}>{busy ? 'Saving...' : 'Agree and continue'}</button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Msg, errText, PageHeader } from '../components';
import { useAuth } from '../auth';
import { useListings } from '../listings';
import { acceptBusinessTerms, BusinessTermsCheck } from '../terms';
import { supabase } from '../supabase';

type Found = { id: string; name: string; address: string | null };
type App = { id: string; business_name: string; status: 'pending' | 'approved' | 'rejected'; review_note: string | null; created_at: string; claim_listing_id: string | null };
type Opts = { configured?: boolean; status: string; is_claim: boolean; verified: boolean; email_match: boolean; phone_last4: string | null; owner_conflict: boolean };

const WHY: Record<string, string> = {
  not_configured: 'Phone codes are not switched on yet. We will review your application by hand instead.',
  no_phone: 'We do not have a phone number listed for this business. We will review your application by hand.',
  too_many: 'Too many tries for today. Try again tomorrow, or wait and we will review it by hand.',
  send_failed: 'We could not send the code. Try the other option (text or call), or wait for our review.',
  bad_code: 'Enter the 6 digit code.',
  expired: 'That code has expired. Ask for a new one.',
  check_failed: 'We could not check that code. Ask for a new one.',
  approve_failed: 'The code was right, but something went wrong saving it. We will finish it by hand.',
};

// Proves the applicant owns the business: instant when their email is on the
// business's own website, otherwise a code to the phone number already listed
// publicly for it. Anything else waits for a person.
function VerifyPanel({ appId, onChange }: { appId: string; onChange: () => void }) {
  const { reload } = useListings();
  const [opts, setOpts] = useState<Opts | null>(null);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<'sms' | 'call' | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState<'approved' | 'review' | null>(null);
  const [emailTried, setEmailTried] = useState(false);

  useEffect(() => {
    let live = true;
    supabase.functions.invoke('verify-ownership', { body: { action: 'options', application_id: appId } }).then(({ data, error }) => {
      if (!live) return;
      if (error || !data || (data as { error?: string }).error) setFailed(true);
      else setOpts(data as Opts);
    });
    return () => { live = false; };
  }, [appId]);

  const finish = useCallback((result: string) => {
    if (result === 'approved') { setDone('approved'); reload(); } else setDone('review');
    onChange();
  }, [onChange, reload]);

  // Email on the business's own domain: approve right away.
  useEffect(() => {
    if (!opts || opts.status !== 'pending' || opts.verified || !opts.email_match || emailTried) return;
    setEmailTried(true);
    supabase.rpc('portal_verify_email', { p_app_id: appId }).then(({ data, error }) => {
      if (error) return setMsg(errText(error));
      if (data === 'approved' || data === 'needs_review') finish(String(data));
    });
  }, [opts, emailTried, appId, finish]);

  async function start(channel: 'sms' | 'call') {
    setBusy(true); setMsg('');
    const { data, error } = await supabase.functions.invoke('verify-ownership', { body: { action: 'start', application_id: appId, channel } });
    setBusy(false);
    const d = (data ?? {}) as { sent?: boolean; error?: string };
    if (error || !d.sent) return setMsg(WHY[d.error ?? ''] ?? 'We could not send the code. Please try again in a minute.');
    setSent(channel); setCode('');
  }

  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg('');
    const { data, error } = await supabase.functions.invoke('verify-ownership', { body: { action: 'check', application_id: appId, code } });
    setBusy(false);
    const d = (data ?? {}) as { verified?: boolean; result?: string; error?: string };
    if (error) return setMsg('We could not check that code. Please try again.');
    if (d.error) return setMsg(WHY[d.error] ?? 'We could not check that code.');
    if (!d.verified) return setMsg('That code is not right. Check it and try again.');
    finish(d.result ?? 'needs_review');
  }

  if (failed || !opts) {
    return failed ? <p className="muted small">We review this by hand, usually within one business day.</p> : null;
  }
  if (done === 'approved') {
    return <Msg kind="ok">Verified. You can now manage this business. <a href="/">Open your dashboard</a>.</Msg>;
  }
  if (done === 'review' || opts.verified) {
    return <Msg kind="ok">Verified. We just need to finish a last check on our side and will email you, usually within one business day.</Msg>;
  }
  if (opts.status !== 'pending' || !opts.is_claim) return null;
  if (opts.email_match) return <p className="muted small">Checking your email against the business website...</p>;
  if (!opts.configured || !opts.phone_last4) {
    return <p className="muted small">We review this by hand, usually within one business day.</p>;
  }
  return (
    <div style={{ background: 'var(--soft, #f4f8f8)', borderRadius: 10, padding: 12, margin: '10px 0' }}>
      <strong>Get approved right away</strong>
      <p className="small" style={{ margin: '6px 0' }}>
        We can send a code to the phone number listed publicly for this business, ending in <strong>{opts.phone_last4}</strong>.
        You need to be able to answer that phone. Not you? Skip this and we will review it by hand.
      </p>
      {opts.owner_conflict && <p className="small">This place already has an account. After you verify, we check with you before moving it.</p>}
      {!sent ? (
        <div className="row">
          <button type="button" disabled={busy} onClick={() => start('sms')}>{busy ? 'Sending...' : 'Text me a code'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => start('call')}>Call me with a code</button>
        </div>
      ) : (
        <form onSubmit={check}>
          <label htmlFor={`code${appId}`}>Enter the code we {sent === 'sms' ? 'texted' : 'read out'} to the number ending in {opts.phone_last4}</label>
          <input id={`code${appId}`} inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button type="submit" disabled={busy || code.replace(/\D/g, '').length < 4}>{busy ? 'Checking...' : 'Verify'}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => start(sent)}>Send a new code</button>
          </div>
        </form>
      )}
      {msg && <Msg kind="err">{msg}</Msg>}
    </div>
  );
}


export function ApplyPage() {
  const { session } = useAuth();
  const [mode, setMode] = useState<'claim' | 'new'>('claim');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [claim, setClaim] = useState<Found | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [subs, setSubs] = useState<Array<{ name: string; category: string }>>([]);
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('Owner');
  const [agree, setAgree] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [apps, setApps] = useState<App[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('business_applications').select('id,business_name,status,review_note,created_at,claim_listing_id')
      .order('created_at', { ascending: false }).limit(20);
    setApps((data ?? []) as App[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from('subcategories').select('name,category').order('category').order('sort').then(({ data }) => setSubs((data ?? []) as Array<{ name: string; category: string }>));
  }, []);
  const categories = Array.from(new Set(subs.map((x) => x.category)));
  const subOptions = subs.filter((x) => x.category === category);

  useEffect(() => {
    const term = q.trim().replace(/[%_,()]/g, ' ');
    if (term.length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('listings').select('id,name,address').or(`name.ilike.%${term}%,aka.ilike.%${term}%`).limit(8);
      setFound((data ?? []) as Found[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(''); setOk('');
    if (!session) return;
    if (mode === 'claim' && !claim) return setErr('Search for your business and pick it from the list.');
    if (mode === 'new' && (!category || !subcategory)) return setErr('Choose a category and a subcategory so visitors can find you.');
    if (mode === 'new' && address.trim().length < 6) return setErr('Enter the street address. If you are a mobile service with no storefront, write "Mobile service" and the town you are based in.');
    if (!agree) return setErr('Please confirm you are allowed to manage this business.');
    if (!termsOk) return setErr('Please agree to the WhileIn Business Listing Terms.');
    setBusy(true);
    // Stores the date and Terms version for this claim. The database refuses
    // the application without it (sql/100).
    const termsErr = await acceptBusinessTerms('claim', mode === 'claim' ? claim!.id : null);
    if (termsErr) { setBusy(false); return setErr(termsErr); }
    const { error } = await supabase.from('business_applications').insert({
      user_id: session.user.id,
      business_name: mode === 'claim' ? claim!.name : name.trim(),
      contact_name: contact.trim() || null,
      phone: phone.trim() || null,
      claim_listing_id: mode === 'claim' ? claim!.id : null,
      new_listing: mode === 'new' ? {
        name: name.trim(), category, subcategory, address: address.trim(), phone: phone.trim(),
        website: website.trim(), description: description.trim(), role,
      } : null,
      notes: [role ? `Role: ${role}` : '', notes.trim()].filter(Boolean).join('\n') || null,
    });
    setBusy(false);
    if (error) return setErr(/violates|limit|pending/i.test(error.message) ? 'You already have applications waiting. We will review them soon.' : errText(error));
    setOk(mode === 'claim' ? 'Thanks. Verify below to get approved right away, or we will review it and email you, usually within one business day.' : 'Thanks. We will review this and email you, usually within one business day.');
    setClaim(null); setQ(''); setName(''); setNotes(''); setWebsite(''); setDescription(''); setAddress(''); setCategory(''); setSubcategory(''); setAgree(false); setTermsOk(false);
    load();
  }

  return (
    <>
      <PageHeader title="Add your business" sub="Claim your listing in the app, or tell us about a new one" />
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ marginBottom: 8 }}>
          <button type="button" className={mode === 'claim' ? '' : 'secondary'} onClick={() => setMode('claim')}>It is already in WhileIn</button>
          <button type="button" className={mode === 'new' ? '' : 'secondary'} onClick={() => setMode('new')}>It is not listed</button>
        </div>

        {mode === 'claim' ? (
          <>
            <label htmlFor="q">Search by name</label>
            <input id="q" value={claim ? claim.name : q} onChange={(e) => { setClaim(null); setQ(e.target.value); }} />
            {!claim && found.map((f) => (
              <button type="button" key={f.id} className="secondary" style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 6 }} onClick={() => setClaim(f)}>
                {f.name}<span className="muted small"> {f.address ?? ''}</span>
              </button>
            ))}
          </>
        ) : (
          <>
            <label htmlFor="n">Business name</label>
            <input id="n" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="c">Category</label>
            <select id="c" value={category} onChange={(e) => { setCategory(e.target.value); setSubcategory(''); }}>
              <option value="">Choose one</option>
              {categories.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <label htmlFor="sc">Subcategory</label>
            <select id="sc" value={subcategory} disabled={!category} onChange={(e) => setSubcategory(e.target.value)}>
              <option value="">{category ? 'Choose one' : 'Choose a category first'}</option>
              {subOptions.map((x) => (<option key={x.name} value={x.name}>{x.name}</option>))}
            </select>
            <label htmlFor="a">Street address</label>
            <input id="a" maxLength={200} placeholder="154 Grayton Blvd, Santa Rosa Beach, FL" value={address} onChange={(e) => setAddress(e.target.value)} />
            <p className="muted small">We place your pin on the map from this address. Mobile service? Write "Mobile service" and the town you are based in.</p>
            <label htmlFor="web">Website (optional)</label>
            <input id="web" type="url" placeholder="https://" maxLength={300} value={website} onChange={(e) => setWebsite(e.target.value)} />
            <label htmlFor="desc">Short description (optional)</label>
            <textarea id="desc" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </>
        )}

        <label htmlFor="cn">Your name</label>
        <input id="cn" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} />
        <label htmlFor="role">Your role</label>
        <select id="role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option>Owner</option><option>Manager</option><option>Marketing or agency</option><option>Other</option>
        </select>
        <label htmlFor="ph">Phone</label>
        <input id="ph" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label htmlFor="no">Anything we should know? (optional)</label>
        <textarea id="no" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I am allowed to manage this business. See our <a href="/privacy" target="_blank" rel="noopener noreferrer">privacy policy</a>.</span></label>
        <BusinessTermsCheck id="claim-terms" checked={termsOk} onChange={setTermsOk} />
        {err && <Msg kind="err">{err}</Msg>}
        {ok && <Msg kind="ok">{ok}</Msg>}
        <div style={{ marginTop: 18 }}><button type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send for approval'}</button></div>
      </form>

      {apps.length > 0 && <h2>Your applications</h2>}
      {apps.map((a) => (
        <div className="card" key={a.id}>
          <div className="row spread"><strong>{a.business_name}</strong><span className={`badge ${a.status}`}>{a.status}</span></div>
          {a.review_note && <p className="muted small">{a.review_note}</p>}
          {a.status === 'pending' && a.claim_listing_id && <VerifyPanel appId={a.id} onChange={load} />}
        </div>
      ))}
    </>
  );
}

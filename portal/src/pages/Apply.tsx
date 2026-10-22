import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Msg, errText, PageHeader } from '../components';
import { useAuth } from '../auth';
import { supabase } from '../supabase';

type Found = { id: string; name: string; address: string | null };
type App = { id: string; business_name: string; status: 'pending' | 'approved' | 'rejected'; review_note: string | null; created_at: string };

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
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [apps, setApps] = useState<App[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('business_applications').select('id,business_name,status,review_note,created_at')
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
      const { data } = await supabase.from('listings').select('id,name,address').ilike('name', `%${term}%`).limit(8);
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
    if (!agree) return setErr('Please confirm you are allowed to manage this business and agree to the terms.');
    setBusy(true);
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
    setOk('Thanks. We will review this and email you, usually within one business day.');
    setClaim(null); setQ(''); setName(''); setNotes(''); setWebsite(''); setDescription(''); setAddress(''); setCategory(''); setSubcategory(''); setAgree(false);
    load();
  }

  return (
    <>
      <PageHeader title="Add your business" sub="Claim your listing in the app, or tell us about a new one" />
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ marginBottom: 8 }}>
          <button type="button" className={mode === 'claim' ? '' : 'secondary'} onClick={() => setMode('claim')}>It is already in in30A</button>
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
        <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I am allowed to manage this business and I agree to the <a href="/privacy" target="_blank" rel="noopener noreferrer">terms and privacy policy</a>.</span></label>
        {err && <Msg kind="err">{err}</Msg>}
        {ok && <Msg kind="ok">{ok}</Msg>}
        <div style={{ marginTop: 18 }}><button type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send for approval'}</button></div>
      </form>

      {apps.length > 0 && <h2>Your applications</h2>}
      {apps.map((a) => (
        <div className="card" key={a.id}>
          <div className="row spread"><strong>{a.business_name}</strong><span className={`badge ${a.status}`}>{a.status}</span></div>
          {a.review_note && <p className="muted small">{a.review_note}</p>}
        </div>
      ))}
    </>
  );
}

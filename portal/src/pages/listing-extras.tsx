// Listing page additions from the walkthrough: visitor preview, photo gallery
// (Premium and up) and change requests for the fields a business cannot edit.
import { ArrowLeft, ArrowRight, MapPin, Navigation, Phone, Globe, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';

import { Msg, errText } from '../components';
import { useListings } from '../listings';
import { useSetting } from '../plans';
import { supabase } from '../supabase';
import { acceptBusinessTerms, BusinessTermsCheck } from '../terms';

const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
type Photo = { id: string; url: string; sort_order: number };

export function usePhotos(listingId: string) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from('listing_photos').select('id,url,sort_order').eq('listing_id', listingId).order('sort_order');
    setPhotos((data ?? []) as Photo[]);
  }, [listingId]);
  useEffect(() => { load(); }, [load]);
  return { photos, reload: load };
}

export function useLimited() {
  const { current } = useListings();
  const limits = useSetting<{ on?: boolean }>('enforce_plan_limits').value;
  return (current?.plan ?? 'basic') === 'basic' && limits?.on === true;
}

/** Roughly how the listing looks in the app, so a business sees what visitors see. */
export function VisitorPreview({ id, photos }: { id: string; photos: Photo[] | null }) {
  const { current } = useListings();
  const limited = useLimited();
  const [stats, setStats] = useState<{ avg: number; count: number } | null>(null);
  useEffect(() => {
    supabase.from('listing_review_stats').select('avg_rating,review_count').eq('listing_id', id).maybeSingle()
      .then(({ data }) => setStats(data ? { avg: Number(data.avg_rating), count: Number(data.review_count) } : null));
  }, [id]);
  if (!current) return null;
  const cover = photos?.[0]?.url;
  const shown = limited ? photos?.slice(0, 1) ?? [] : photos ?? [];
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>What visitors see</h2>
      <div style={{ maxWidth: 380, border: '1px solid var(--line)', borderRadius: 20, overflow: 'hidden', background: 'var(--sand)' }}>
        {cover ? (
          <img src={cover} alt="" style={{ width: '100%', aspectRatio: '3 / 2', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ aspectRatio: '3 / 2', display: 'grid', placeItems: 'center' }} className="muted small">No photo yet, the app shows a default picture</div>
        )}
        <div style={{ padding: 14 }}>
          {current.plan === 'featured' || current.plan === 'spotlight' ? <span className="badge approved">{current.plan === 'spotlight' ? 'Spotlight' : 'Featured'}</span> : null}
          <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
            {!limited && current.logo_url ? <img src={current.logo_url} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} /> : null}
            <strong style={{ fontSize: '1.15rem' }}>{current.name}</strong>
          </div>
          {current.subcategory && <div className="muted small">{current.subcategory}</div>}
          {current.address && <div className="muted small"><MapPin size={13} /> {current.address}</div>}
          <div className="small" style={{ marginTop: 6 }}>
            {stats && stats.count > 0 ? <><Star size={13} color="#C88A1E" /> {stats.avg.toFixed(1)} ({stats.count} {stats.count === 1 ? 'review' : 'reviews'})</> : <span className="muted">New on in30A, be the first to rate</span>}
          </div>
          {current.hours_note && <div className="small" style={{ marginTop: 6 }}>{current.hours_note}</div>}
          {!limited && current.description && <p className="small" style={{ marginBottom: 0 }}>{current.description}</p>}
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {current.phone && <span className="badge"><Phone size={13} /> Call</span>}
            <span className="badge"><Navigation size={13} /> Directions</span>
            {!limited && current.website && <span className="badge"><Globe size={13} /> Website</span>}
          </div>
          {shown.length > 1 && <div className="muted small" style={{ marginTop: 8 }}>{shown.length} photos in the gallery</div>}
        </div>
      </div>
      {limited && <p className="muted small">On Basic, visitors see your name, address, map pin, phone, hours and one cover photo.</p>}
    </div>
  );
}

/** Premium and up: up to 12 photos. The first one is the cover. */
export function Gallery({ id, photos, reload }: { id: string; photos: Photo[] | null; reload: () => void }) {
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setErr('');
    if (!terms) return setErr('Please agree to the in30A Business Listing Terms before you upload.');
    setBusy(true);
    const termsErr = await acceptBusinessTerms('upload', id);
    if (termsErr) { setBusy(false); return setErr(termsErr); }
    for (const file of files) {
      const ext = TYPES[file.type];
      if (!ext) { setErr(`${file.name}: use a PNG, JPG or WebP image.`); continue; }
      if (file.size > 5 * 1024 * 1024) { setErr(`${file.name}: must be under 5 MB.`); continue; }
      const path = `${id}/gallery-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const up = await supabase.storage.from('listing-assets').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) { setErr(errText(up.error)); break; }
      const url = supabase.storage.from('listing-assets').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.rpc('portal_add_photo', { p_listing_id: id, p_url: url });
      if (error) { setErr(errText(error)); break; }
    }
    setBusy(false);
    setTerms(false);
    reload();
  }

  async function run(fn: string, args: Record<string, unknown>) {
    setErr(''); setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) setErr(errText(error));
    reload();
  }

  const list = photos ?? [];
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Photos</h2>
      <p className="muted small">Up to 12 photos. The first one is your cover, on your card in lists, on the map and at the top of your page. Use the arrows to change the order. JPG, PNG or WebP, under 5 MB each.</p>
      {list.length === 0 && <p className="muted small">No photos yet.</p>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {list.map((p, i) => (
          <div key={p.id} style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: 'var(--shell)' }}>
            <img src={p.url} alt={i === 0 ? 'Cover photo' : `Photo ${i + 1}`} style={{ width: '100%', aspectRatio: '3 / 2', objectFit: 'cover', display: 'block' }} />
            <div className="row" style={{ gap: 4, padding: 6, justifyContent: 'space-between' }}>
              <span className="small">{i === 0 ? <strong>Cover</strong> : `#${i + 1}`}</span>
              <span className="row" style={{ gap: 2 }}>
                <button type="button" className="ghost" aria-label="Move earlier" disabled={busy || i === 0} onClick={() => run('portal_move_photo', { p_photo_id: p.id, p_up: true })}><ArrowLeft size={16} /></button>
                <button type="button" className="ghost" aria-label="Move later" disabled={busy || i === list.length - 1} onClick={() => run('portal_move_photo', { p_photo_id: p.id, p_up: false })}><ArrowRight size={16} /></button>
                <button type="button" className="ghost" aria-label="Delete photo" disabled={busy} onClick={() => { if (window.confirm('Delete this photo?')) run('portal_delete_photo', { p_photo_id: p.id }); }}><Trash2 size={16} /></button>
              </span>
            </div>
          </div>
        ))}
      </div>
      {list.length < 12 && (
        <div style={{ marginTop: 12 }}>
          <BusinessTermsCheck id="gallery-terms" checked={terms} onChange={setTerms} />
          <label htmlFor="gal">Add photos</label>
          <input id="gal" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={busy || !terms} />
        </div>
      )}
      {busy && <p className="muted small">Working...</p>}
      {err && <Msg kind="err">{err}</Msg>}
    </div>
  );
}

type Change = { id: string; fields: Record<string, string>; note: string | null; status: string; admin_note: string | null; created_at: string };
const FIELD_LABEL: Record<string, string> = { name: 'Name', address: 'Address', category: 'Category', subcategory: 'Subcategory', other: 'Something else' };

/** Name, address and category are checked by us, so businesses ask here. */
export function ChangeRequests({ id }: { id: string }) {
  const { current } = useListings();
  const [rows, setRows] = useState<Change[]>([]);
  const [subs, setSubs] = useState<Array<{ name: string; category: string }>>([]);
  const [f, setF] = useState({ name: '', address: '', subcategory: '', other: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('change_requests').select('id,fields,note,status,admin_note,created_at').eq('listing_id', id).order('created_at', { ascending: false }).limit(20);
    setRows((data ?? []) as Change[]);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from('subcategories').select('name,category').order('category').order('sort').then(({ data }) => setSubs((data ?? []) as Array<{ name: string; category: string }>));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(''); setOk('');
    const sub = subs.find((s) => s.name === f.subcategory);
    const fields: Record<string, string> = { name: f.name, address: f.address, subcategory: f.subcategory, other: f.other };
    if (sub && sub.category !== current?.category) fields.category = sub.category;
    setBusy(true);
    const { error } = await supabase.rpc('portal_request_change', { p_listing_id: id, p_fields: fields, p_note: f.note || null });
    setBusy(false);
    if (error) return setErr(errText(error));
    setOk('Sent. We check it and email you, usually within one business day.');
    setF({ name: '', address: '', subcategory: '', other: '', note: '' });
    load();
  }

  const groups = Array.from(new Set(subs.map((s) => s.category)));
  return (
    <form className="card" id="changes" onSubmit={submit}>
      <h2 style={{ marginTop: 0 }}>Ask us to change something</h2>
      <p className="muted small">Your name, address and category are checked by us before they change, so they cannot be edited directly. Fill in only what should change.</p>
      <label htmlFor="cr-n">New name (now: {current?.name})</label>
      <input id="cr-n" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <label htmlFor="cr-a">New address (now: {current?.address ?? 'none'})</label>
      <input id="cr-a" maxLength={200} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <label htmlFor="cr-s">New category (now: {current?.subcategory ?? current?.category ?? 'none'})</label>
      <select id="cr-s" value={f.subcategory} onChange={(e) => setF({ ...f, subcategory: e.target.value })}>
        <option value="">No change</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {subs.filter((s) => s.category === g).map((s) => (<option key={s.name} value={s.name}>{s.name}</option>))}
          </optgroup>
        ))}
      </select>
      <label htmlFor="cr-o">Something else</label>
      <input id="cr-o" maxLength={500} placeholder="For example: the map pin is on the wrong side of the road" value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} />
      <label htmlFor="cr-note">Note for us (optional)</label>
      <textarea id="cr-note" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      {err && <Msg kind="err">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}
      <div style={{ marginTop: 14 }}><button type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send request'}</button></div>

      {rows.length > 0 && <h3>Your requests</h3>}
      {rows.map((r) => (
        <div key={r.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
          <div className="row spread">
            <span className="small">{Object.entries(r.fields).map(([k, v]) => `${FIELD_LABEL[k] ?? k}: ${v}`).join(' · ')}</span>
            <span className={`badge ${r.status === 'done' ? 'approved' : r.status === 'declined' ? 'rejected' : 'pending'}`}>{r.status === 'done' ? 'Done' : r.status === 'declined' ? 'Declined' : 'Waiting'}</span>
          </div>
          {r.admin_note && <p className="muted small" style={{ margin: '4px 0 0' }}>{r.admin_note}</p>}
        </div>
      ))}
    </form>
  );
}

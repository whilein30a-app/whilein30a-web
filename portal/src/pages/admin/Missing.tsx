// A17: listings whose details or pin still come from Google, or are missing.
// Admin fills them by hand here. Saving a value replaces the Google one (sql/104).
import { ListChecks } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { Empty, Msg, PageHeader, errText } from '../../components';
import { supabase } from '../../supabase';

type Row = {
  id: string; name: string; category: string | null; subcategory: string | null; town: string | null; address: string | null;
  phone: string | null; website: string | null; hours_note: string | null; has_hours: boolean; photos: number;
  has_pin: boolean; coords_source: string | null; google_fields: string[]; google_photos: number;
  owned: boolean; plan: string | null; in_area: boolean;
};
type Summary = Record<string, number | string | null>;

const FILTERS: Array<[string, string]> = [
  ['all', 'Everything'],
  ['google_pin', 'Pin from Google'],
  ['no_pin', 'No pin'],
  ['google_details', 'Details from Google'],
  ['google_photo', 'Photo from Google'],
  ['no_phone', 'No phone'],
  ['no_hours', 'No hours'],
  ['no_photo', 'No photo'],
];
const FIELD_NAME: Record<string, string> = {
  phone: 'phone', website: 'website', description: 'description', address: 'address', hours: 'hours', attributes: 'attributes', status: 'open status',
};

function RowCard({ r, onSaved }: { r: Row; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(r.phone ?? '');
  const [website, setWebsite] = useState(r.website ?? '');
  const [hours, setHours] = useState(r.hours_note ?? '');
  const [address, setAddress] = useState(r.address ?? '');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const problems = [
    r.coords_source === 'google' ? 'pin from Google' : null,
    !r.has_pin ? 'no pin' : null,
    r.google_fields.length ? `${r.google_fields.map((f) => FIELD_NAME[f] ?? f).join(', ')} from Google` : null,
    r.google_photos ? `${r.google_photos} Google ${r.google_photos === 1 ? 'photo' : 'photos'}` : null,
    !r.phone ? 'no phone' : null,
    !r.has_hours ? 'no hours' : null,
    !r.photos ? 'no photo' : null,
  ].filter(Boolean);

  async function findPin() {
    setMsg(''); setErr('');
    const { data, error } = await supabase.functions.invoke('geocode-address', { body: { address } });
    let why = (data as { error?: string } | null)?.error ?? '';
    if (error && !why) {
      try { why = (await (error as unknown as { context?: Response }).context?.json())?.error ?? ''; } catch { /* ignore */ }
    }
    if (error || why) return setErr((why || 'Could not look that address up.') + ' You can type the numbers yourself.');
    const d = data as { lat: number; lng: number; formatted: string; confidence?: string };
    setLat(String(d.lat)); setLng(String(d.lng));
    setMsg(`Found: ${d.formatted}${d.confidence && d.confidence !== 'exact' && d.confidence !== 'high' ? ` (${d.confidence} confidence, check it)` : ''}. Save to use it.`);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    const fields: Record<string, string> = {};
    if (phone !== (r.phone ?? '')) fields.phone = phone.trim();
    if (website !== (r.website ?? '')) fields.website = website.trim();
    if (hours !== (r.hours_note ?? '')) fields.hours_note = hours.trim();
    if (Object.keys(fields).length) {
      const { error } = await supabase.rpc('portal_update_listing', { p_listing_id: r.id, p_fields: fields });
      if (error) { setBusy(false); return setErr(errText(error)); }
    }
    if (address.trim() && address !== (r.address ?? '')) {
      const { error } = await supabase.rpc('admin_set_address', { p_listing_id: r.id, p_address: address.trim() });
      if (error) { setBusy(false); return setErr(errText(error)); }
    }
    if (lat.trim() && lng.trim()) {
      const { error } = await supabase.rpc('admin_set_pin', { p_listing_id: r.id, p_lat: Number(lat), p_lng: Number(lng) });
      if (error) { setBusy(false); return setErr(errText(error)); }
    }
    setBusy(false);
    setMsg('Saved.');
    onSaved();
  }

  return (
    <div className="card">
      <div className="row spread">
        <div>
          <Link to={`/admin/business/${r.id}`}><strong>{r.name}</strong></Link>
          <div className="muted small">{[r.subcategory ?? r.category, r.town, r.owned ? 'claimed' : 'unclaimed', r.in_area ? null : 'hidden (no pin)'].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Close' : 'Fill in'}</button>
      </div>
      <p className="small" style={{ margin: '8px 0 0' }}>{problems.join(' · ')}</p>
      {open && (
        <form onSubmit={save} style={{ marginTop: 12 }}>
          <div className="grid two">
            <label>Phone<input value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} placeholder="(850) 555-0100" /></label>
            <label>Website<input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></label>
          </div>
          <label>Hours<textarea rows={3} maxLength={600} value={hours} onChange={(e) => setHours(e.target.value)} placeholder={'Mon to Fri 9 AM to 5 PM\nSat 10 AM to 2 PM'} /></label>
          <label>Address<input value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} /></label>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>Latitude<input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="30.32" /></label>
            <label style={{ flex: 1 }}>Longitude<input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-86.14" /></label>
            <button type="button" className="secondary" onClick={findPin} disabled={!address.trim()}>Find pin from address</button>
          </div>
          <p className="muted small">Use the business's own website or a call to fill these in, not Google. Leave the pin empty to keep the current one.</p>
          {err && <Msg kind="err">{err}</Msg>}
          {msg && <Msg kind="ok">{msg}</Msg>}
          <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
        </form>
      )}
    </div>
  );
}

export function MissingPage() {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [list, s] = await Promise.all([
      supabase.rpc('admin_missing_details', { p_problem: filter, p_search: search || null, p_limit: 300 }),
      supabase.rpc('admin_missing_summary'),
    ]);
    if (list.error) return setErr(errText(list.error));
    setErr('');
    setRows((list.data ?? []) as Row[]);
    setSum((s.data as Summary) ?? null);
  }, [filter, search]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title="Missing details" sub="Listings to fill in by hand, so nothing shown in the app comes from Google" />
      {sum && (
        <p className="muted small">
          {String(sum.google_pin)} pins from Google · {String(sum.no_pin)} with no pin · {String(sum.google_details)} with Google details ·
          {' '}{String(sum.google_photo)} with Google photos · {String(sum.no_phone)} with no phone · {String(sum.no_hours)} with no hours
          {sum.cleared_at ? ` · Google values cleared ${new Date(String(sum.cleared_at)).toLocaleDateString()}` : ''}
        </p>
      )}
      <div className="toggle" role="group" aria-label="Filter" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}{sum && k !== 'all' && sum[k] != null ? ` (${sum[k]})` : ''}
          </button>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} style={{ marginBottom: 14 }}>
        <input aria-label="Business name" placeholder="Business name" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button type="submit">Search</button>
      </form>
      {err && <Msg kind="err">{err}</Msg>}
      {rows && rows.length === 0 && <Empty icon={<ListChecks size={22} />} title="Nothing to fill in here" />}
      {(rows ?? []).map((r) => (<RowCard key={r.id} r={r} onSaved={load} />))}
      {rows && rows.length >= 300 && <p className="muted small">Showing the first 300. Search or pick a filter to narrow it down.</p>}
    </>
  );
}

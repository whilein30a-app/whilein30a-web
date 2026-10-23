import { useCallback, useEffect, useState } from 'react';

import { Msg, errText, PageHeader } from '../../components';
import { PLAN_NAME, type PlanId } from '../../plans';
import { supabase } from '../../supabase';

type Row = {
  id: string; name: string; category: string | null; subcategory: string | null;
  plan: PlanId; billing: 'month' | 'year' | null; is_founding: boolean | null; plan_expires_on: string | null;
  latitude: number | null; longitude: number | null; address: string | null;
  area_status: 'core' | 'serves_30a' | 'outside' | null; area_status_override: string | null; area_reason: string | null; town: string | null;
};

const AREA_LABEL: Record<string, string> = { core: 'Inside 30A', serves_30a: 'Serves 30A (based outside)', outside: 'Outside 30A (hidden)' };
type Sub = { name: string; category: string; sort: number };
type Slot = { category: string; subcategory: string; featured_names: string[]; spotlight_names: string[] };

function Editor({ row, subs, onDone }: { row: Row; subs: Sub[]; onDone: (msg: string) => void }) {
  const [sub, setSub] = useState(row.subcategory ?? '');
  const [plan, setPlan] = useState<PlanId>(row.plan ?? 'basic');
  const [billing, setBilling] = useState<'month' | 'year'>(row.billing ?? 'month');
  const [founding, setFounding] = useState(!!row.is_founding);
  const [expires, setExpires] = useState(row.plan_expires_on ?? '');
  const [area, setArea] = useState(row.area_status_override ?? '');
  const [areaWhy, setAreaWhy] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [lat, setLat] = useState(row.latitude != null ? String(row.latitude) : '');
  const [lng, setLng] = useState(row.longitude != null ? String(row.longitude) : '');
  const [pinMsg, setPinMsg] = useState('');

  async function findPin() {
    setPinMsg('');
    const { data, error } = await supabase.functions.invoke('geocode-address', { body: { address: row.address ?? '' } });
    let why = (data as { error?: string } | null)?.error ?? '';
    if (error && !why) {
      try { why = (await (error as unknown as { context?: Response }).context?.json())?.error ?? ''; } catch { /* ignore */ }
    }
    if (error || why) return setPinMsg((why || 'Could not look that address up.') + ' You can type the numbers yourself.');
    const d = data as { lat: number; lng: number; formatted: string };
    setLat(String(d.lat)); setLng(String(d.lng));
    setPinMsg(`Found: ${d.formatted}. Check it, then Save.`);
  }

  // A free-text category (an old application said "Vacation rental") matches
  // no parent, so every subcategory is offered, grouped. Saving one sets the
  // parent category too (sql/098).
  const known = subs.some((s) => s.category === row.category);
  const options = subs.filter((s) => !known || s.category === row.category);
  const groups = Array.from(new Set(options.map((s) => s.category)));

  async function save() {
    setErr(''); setBusy(true);
    if ((row.subcategory ?? '') !== sub) {
      const r = await supabase.rpc('admin_set_subcategory', { p_listing_id: row.id, p_subcategory: sub || null });
      if (r.error) { setBusy(false); return setErr(errText(r.error)); }
    }
    if ((row.area_status_override ?? '') !== area) {
      const r = await supabase.rpc('admin_set_area', { p_listing_id: row.id, p_status: area || null, p_reason: areaWhy || null });
      if (r.error) { setBusy(false); return setErr(errText(r.error)); }
    }
    const pinChanged = lat.trim() !== (row.latitude != null ? String(row.latitude) : '') || lng.trim() !== (row.longitude != null ? String(row.longitude) : '');
    if (pinChanged && lat.trim() && lng.trim()) {
      const r = await supabase.rpc('admin_set_pin', { p_listing_id: row.id, p_lat: Number(lat), p_lng: Number(lng) });
      if (r.error) { setBusy(false); return setErr(errText(r.error)); }
    }
    const { error } = await supabase.rpc('admin_set_plan', {
      p_listing_id: row.id, p_plan: plan, p_billing: plan === 'basic' ? null : billing,
      p_founding: founding, p_expires_on: plan === 'basic' ? null : expires || null,
    });
    setBusy(false);
    if (error) return setErr(errText(error));
    onDone(`${row.name} saved.`);
  }

  return (
    <div className="card">
      <div className="row spread">
        <div><strong>{row.name}</strong> <span className="muted small">{row.category}{row.town ? ` · ${row.town}` : ''}</span></div>
        <span className={`badge ${row.area_status === 'outside' ? 'rejected' : 'approved'}`}>{AREA_LABEL[row.area_status ?? ''] ?? 'Not checked'}</span>
      </div>
      {row.area_reason && <p className="muted small" style={{ margin: '4px 0 0' }}>Area: {row.area_reason}</p>}
      <div className="grid" style={{ marginTop: 8 }}>
        <div>
          <label htmlFor={`s${row.id}`}>Subcategory</label>
          <select id={`s${row.id}`} value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="">None</option>
            {groups.length > 1
              ? groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {options.filter((s) => s.category === g).map((s) => (<option key={s.name} value={s.name}>{s.name}</option>))}
                  </optgroup>
                ))
              : options.map((s) => (<option key={s.name} value={s.name}>{s.name}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor={`p${row.id}`}>Plan</label>
          <select id={`p${row.id}`} value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
            {(Object.keys(PLAN_NAME) as PlanId[]).map((p) => (<option key={p} value={p}>{PLAN_NAME[p]}</option>))}
          </select>
        </div>
        {plan !== 'basic' && (
          <>
            <div>
              <label htmlFor={`b${row.id}`}>Billing</label>
              <select id={`b${row.id}`} value={billing} onChange={(e) => setBilling(e.target.value as 'month' | 'year')}>
                <option value="month">Monthly</option>
                <option value="year">Yearly</option>
              </select>
            </div>
            <div>
              <label htmlFor={`e${row.id}`}>Paid through</label>
              <input id={`e${row.id}`} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
          </>
        )}
      </div>
      <div className="grid">
        <div>
          <label htmlFor={`a${row.id}`}>Area</label>
          <select id={`a${row.id}`} value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Automatic (from its location)</option>
            <option value="core">Inside 30A</option>
            <option value="serves_30a">Serves 30A, based outside</option>
            <option value="outside">Outside 30A, hide it</option>
          </select>
        </div>
        {(row.area_status_override ?? '') !== area && area && (
          <div>
            <label htmlFor={`w${row.id}`}>Why (required)</label>
            <input id={`w${row.id}`} value={areaWhy} maxLength={200} placeholder="e.g. delivers golf carts to 30A rentals" onChange={(e) => setAreaWhy(e.target.value)} />
          </div>
        )}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <strong className="small">Map pin</strong>
        <input style={{ width: 130 }} aria-label="Latitude" placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} />
        <input style={{ width: 130 }} aria-label="Longitude" placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} />
        <button type="button" className="secondary" onClick={findPin} disabled={!row.address}>Find from address</button>
        {lat && lng && <a className="small" href={`https://www.google.com/maps?q=${encodeURIComponent(lat + ',' + lng)}`} target="_blank" rel="noopener noreferrer">Check on map</a>}
      </div>
      {pinMsg && <p className="small" style={{ margin: '4px 0 0' }}>{pinMsg}</p>}
      <label className="check"><input type="checkbox" checked={founding} onChange={(e) => setFounding(e.target.checked)} /><span>Founding Partner</span></label>
      {err && <Msg kind="err">{err}</Msg>}
      <div style={{ marginTop: 12 }}><button type="button" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save'}</button></div>
    </div>
  );
}

export function PlansPage() {
  const [q, setQ] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [onlyServes, setOnlyServes] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [founders, setFounders] = useState(0);
  const [unassigned, setUnassigned] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const loadStatic = useCallback(async () => {
    const [s, sl, f, u] = await Promise.all([
      supabase.from('subcategories').select('name,category,sort').order('category').order('sort'),
      supabase.rpc('admin_slots_overview'),
      supabase.from('listings').select('id', { count: 'exact', head: true }).eq('is_founding', true),
      supabase.from('listings').select('id', { count: 'exact', head: true }).is('subcategory', null).eq('is_public_access', false),
    ]);
    setSubs((s.data ?? []) as Sub[]);
    setSlots((sl.data ?? []) as Slot[]);
    setFounders(f.count ?? 0);
    setUnassigned(u.count ?? 0);
  }, []);

  const search = useCallback(async () => {
    let query = supabase.from('listings')
      .select('id,name,category,subcategory,address,latitude,longitude,plan,billing,is_founding,plan_expires_on,area_status,area_status_override,area_reason,town')
      .order('name').limit(25);
    const term = q.trim().replace(/[%,()]/g, ' ');
    if (term) query = query.ilike('name', `%${term}%`);
    if (onlyUnassigned) query = query.is('subcategory', null).eq('is_public_access', false);
    if (onlyServes) query = query.eq('area_status', 'serves_30a');
    const { data, error } = await query;
    if (error) setErr(errText(error));
    setRows((data ?? []) as Row[]);
  }, [q, onlyUnassigned, onlyServes]);

  useEffect(() => { loadStatic(); }, [loadStatic]);
  useEffect(() => { const t = setTimeout(search, 250); return () => clearTimeout(t); }, [search]);

  async function auto() {
    setErr(''); setMsg('');
    const { data, error } = await supabase.rpc('admin_autoassign_subcategories');
    if (error) return setErr(errText(error));
    setMsg(`Assigned ${data ?? 0} listings. Check them below, these are keyword guesses.`);
    loadStatic(); search();
  }

  function done(m: string) { setMsg(m); setErr(''); loadStatic(); search(); }

  const withSlots = slots.filter((s) => s.featured_names.length > 0 || s.spotlight_names.length > 0);

  return (
    <>
      <PageHeader title="Plans and slots" sub="Set plans, subcategories and areas, and see open Featured and Spotlight slots" />
      <div className="grid">
        <div className="tile"><div className="n">{founders} / 20</div><div className="l">Founding Partners</div></div>
        <div className="tile"><div className="n">{unassigned}</div><div className="l">Listings without a subcategory</div></div>
      </div>
      {msg && <Msg kind="ok">{msg}</Msg>}
      {err && <Msg kind="err">{err}</Msg>}

      <h2>Find a business</h2>
      <div className="row">
        <input style={{ flex: 1, minWidth: 200 }} placeholder="Search by name" aria-label="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /><span>No subcategory</span>
        </label>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={onlyServes} onChange={(e) => setOnlyServes(e.target.checked)} /><span>Serves 30A, to confirm</span>
        </label>
        <button type="button" className="secondary" onClick={auto}>Auto-assign subcategories</button>
      </div>
      {rows.length === 0 && <p className="muted">No matches.</p>}
      {rows.map((r) => (<Editor key={r.id + r.plan + (r.subcategory ?? '') + (r.area_status_override ?? '')} row={r} subs={subs} onDone={done} />))}

      <h2>Featured and Spotlight slots</h2>
      <p className="muted small">Up to 3 Featured and 1 Spotlight per subcategory. Empty rows are open.</p>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Subcategory</th><th>Featured (3)</th><th>Spotlight (1)</th></tr></thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.subcategory}>
                <td>{s.subcategory}<div className="muted small">{s.category}</div></td>
                <td>{s.featured_names.length > 0 ? s.featured_names.join(', ') : <span className="muted">3 open</span>}
                  {s.featured_names.length > 0 && s.featured_names.length < 3 && <div className="muted small">{3 - s.featured_names.length} open</div>}</td>
                <td>{s.spotlight_names.length > 0 ? s.spotlight_names.join(', ') : <span className="muted">Open</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {withSlots.length === 0 && <p className="muted small">No slots taken yet.</p>}
      </div>
    </>
  );
}

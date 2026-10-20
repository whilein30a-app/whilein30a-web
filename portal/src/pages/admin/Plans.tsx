import { useCallback, useEffect, useState } from 'react';

import { Msg, errText } from '../../components';
import { PLAN_NAME, type PlanId } from '../../plans';
import { supabase } from '../../supabase';

type Row = {
  id: string; name: string; category: string | null; subcategory: string | null;
  plan: PlanId; billing: 'month' | 'year' | null; is_founding: boolean | null; plan_expires_on: string | null;
};
type Sub = { name: string; category: string; sort: number };
type Slot = { category: string; subcategory: string; featured_names: string[]; spotlight_names: string[] };

function Editor({ row, subs, onDone }: { row: Row; subs: Sub[]; onDone: (msg: string) => void }) {
  const [sub, setSub] = useState(row.subcategory ?? '');
  const [plan, setPlan] = useState<PlanId>(row.plan ?? 'basic');
  const [billing, setBilling] = useState<'month' | 'year'>(row.billing ?? 'month');
  const [founding, setFounding] = useState(!!row.is_founding);
  const [expires, setExpires] = useState(row.plan_expires_on ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const options = subs.filter((s) => !row.category || s.category === row.category);

  async function save() {
    setErr(''); setBusy(true);
    if ((row.subcategory ?? '') !== sub) {
      const r = await supabase.rpc('admin_set_subcategory', { p_listing_id: row.id, p_subcategory: sub || null });
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
      <strong>{row.name}</strong> <span className="muted small">{row.category}</span>
      <div className="grid" style={{ marginTop: 8 }}>
        <div>
          <label htmlFor={`s${row.id}`}>Subcategory</label>
          <select id={`s${row.id}`} value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="">None</option>
            {options.map((s) => (<option key={s.name} value={s.name}>{s.name}</option>))}
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
      <label className="check"><input type="checkbox" checked={founding} onChange={(e) => setFounding(e.target.checked)} /><span>Founding Partner</span></label>
      {err && <Msg kind="err">{err}</Msg>}
      <div style={{ marginTop: 12 }}><button type="button" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save'}</button></div>
    </div>
  );
}

export function PlansPage() {
  const [q, setQ] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
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
      .select('id,name,category,subcategory,plan,billing,is_founding,plan_expires_on')
      .order('name').limit(25);
    const term = q.trim().replace(/[%,()]/g, ' ');
    if (term) query = query.ilike('name', `%${term}%`);
    if (onlyUnassigned) query = query.is('subcategory', null).eq('is_public_access', false);
    const { data, error } = await query;
    if (error) setErr(errText(error));
    setRows((data ?? []) as Row[]);
  }, [q, onlyUnassigned]);

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
      <h1>Plans</h1>
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
        <button type="button" className="secondary" onClick={auto}>Auto-assign subcategories</button>
      </div>
      {rows.length === 0 && <p className="muted">No matches.</p>}
      {rows.map((r) => (<Editor key={r.id + r.plan + (r.subcategory ?? '')} row={r} subs={subs} onDone={done} />))}

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

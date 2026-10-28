// Change requests from businesses for name, address and category.
import { MessageSquareText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Empty, Msg, PageHeader, errText } from '../../components';
import { supabase } from '../../supabase';

type Row = {
  id: string; listing_id: string; listing_name: string; listing_address: string | null; listing_category: string | null; listing_subcategory: string | null;
  fields: Record<string, string>; note: string | null; status: string; admin_note: string | null; created_at: string; email: string | null;
};
const LABEL: Record<string, string> = { name: 'Name', address: 'Address', category: 'Category', subcategory: 'Subcategory', other: 'Other' };

function current(r: Row, k: string) {
  if (k === 'name') return r.listing_name;
  if (k === 'address') return r.listing_address;
  if (k === 'category') return r.listing_category;
  if (k === 'subcategory') return r.listing_subcategory;
  return null;
}

function Item({ r, onDone }: { r: Row; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function resolve(apply: boolean) {
    setErr('');
    if (!apply && !note.trim()) return setErr('Give a reason when you decline. The business sees it.');
    setBusy(true);
    const { error } = await supabase.rpc('admin_resolve_change', { p_id: r.id, p_apply: apply, p_note: note || null });
    setBusy(false);
    if (error) return setErr(errText(error));
    onDone();
  }
  return (
    <div className="card">
      <div className="row spread">
        <Link to={`/admin/business/${r.listing_id}`}><strong>{r.listing_name}</strong></Link>
        <span className="muted small">{r.email} · {new Date(r.created_at).toLocaleDateString()}</span>
      </div>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Field</th><th>Now</th><th>Asked for</th></tr></thead>
        <tbody>
          {Object.entries(r.fields).map(([k, v]) => (
            <tr key={k}><td className="small">{LABEL[k] ?? k}</td><td className="small muted">{current(r, k) ?? ''}</td><td className="small"><strong>{v}</strong></td></tr>
          ))}
        </tbody>
      </table>
      {r.note && <p className="small">Note: {r.note}</p>}
      {r.fields.address && <p className="muted small">Address change: after applying, move the map pin in Plans and slots.</p>}
      {r.status === 'pending' ? (
        <>
          <input placeholder="Note to the business (required to decline)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          {err && <Msg kind="err">{err}</Msg>}
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" disabled={busy} onClick={() => resolve(true)}>{r.fields.other && Object.keys(r.fields).length === 1 ? 'Mark done' : 'Apply'}</button>
            <button type="button" className="secondary" disabled={busy || !note.trim()} onClick={() => resolve(false)}>Decline</button>
          </div>
        </>
      ) : (
        <p className="small"><span className={`badge ${r.status === 'done' ? 'approved' : 'rejected'}`}>{r.status}</span> {r.admin_note}</p>
      )}
    </div>
  );
}

export function ChangesPage() {
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_change_requests', { p_status: status });
    if (error) return setErr(errText(error));
    setErr('');
    setRows((data ?? []) as Row[]);
  }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <PageHeader title="Change requests" sub="Businesses asking to change their name, address or category" />
      <div className="toggle" role="group" aria-label="Which requests" style={{ marginBottom: 14 }}>
        <button type="button" aria-pressed={status === 'pending'} onClick={() => setStatus('pending')}>Waiting</button>
        <button type="button" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>All</button>
      </div>
      {err && <Msg kind="err">{err}</Msg>}
      {rows && rows.length === 0 && <Empty icon={<MessageSquareText size={22} />} title="Nothing waiting" />}
      {(rows ?? []).map((r) => (<Item key={r.id} r={r} onDone={load} />))}
    </>
  );
}

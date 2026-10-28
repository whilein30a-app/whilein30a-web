// Review moderation (Trello A43). Hiding or removing needs a rule; a review is
// never hidden for being negative. Every action is written to the log.
import { Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Empty, Msg, PageHeader, errText } from '../../components';
import { MODERATION_RULES } from '../../reviews';
import { supabase } from '../../supabase';

type Row = {
  id: string; listing_id: string; listing_name: string; rating: number; comment: string | null; status: 'visible' | 'hidden' | 'removed';
  created_at: string; updated_at: string; edit_count: number; prompted: boolean; visit_signal: string[];
  reviewer_id: string; reviewer_email: string | null; phone_verified_at: string | null; posting_banned: boolean; last_action: string | null;
};
type Hist = { kind: string; at: string; detail: string };

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

function ReviewCard({ r, onDone }: { r: Row; onDone: () => void }) {
  const [rule, setRule] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hist, setHist] = useState<Hist[] | null>(null);

  async function act(action: 'hide' | 'remove' | 'restore') {
    setErr('');
    if (action !== 'restore' && !rule) return setErr('Pick the rule this review breaks. A negative review that breaks no rule stays up.');
    if (action === 'remove' && !window.confirm('Remove this review for good? The reviewer cannot edit it after this.')) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_moderate_review', { p_id: r.id, p_action: action, p_rule: rule || null, p_note: note || null });
    setBusy(false);
    if (error) return setErr(errText(error));
    onDone();
  }

  async function ban(on: boolean) {
    const reason = on ? window.prompt('Why is this person banned from posting? (saved in the audit log)') : '';
    if (on && !reason) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_posting_ban', { p_user: r.reviewer_id, p_ban: on, p_reason: reason || null });
    setBusy(false);
    if (error) return setErr(errText(error));
    onDone();
  }

  async function history() {
    const { data, error } = await supabase.rpc('admin_review_history', { p_id: r.id });
    if (error) return setErr(errText(error));
    setHist((data ?? []) as Hist[]);
  }

  return (
    <div className="card">
      <div className="row spread">
        <strong>{r.listing_name}</strong>
        <span className={`badge ${r.status === 'visible' ? 'approved' : r.status === 'hidden' ? 'pending' : 'rejected'}`}>{r.status}</span>
      </div>
      <div style={{ color: '#C88A1E', fontSize: '1.1rem', margin: '4px 0' }} aria-label={`${r.rating} stars`}>{stars(r.rating)}</div>
      {r.comment ? <p style={{ margin: '4px 0 8px' }}>{r.comment}</p> : <p className="muted small">No comment</p>}
      <p className="muted small" style={{ margin: 0 }}>
        {[r.reviewer_email, r.phone_verified_at ? 'phone confirmed' : 'phone not confirmed', `posted ${when(r.created_at)}`,
          r.edit_count ? `edited ${r.edit_count}x, last ${when(r.updated_at)}` : null, r.prompted ? 'from a rate prompt' : null,
          r.visit_signal?.length ? `visit: ${r.visit_signal.join(', ')}` : null, r.posting_banned ? 'BANNED from posting' : null,
          r.last_action ? `last action: ${r.last_action}` : null].filter(Boolean).join(' · ')}
      </p>
      <div className="grid" style={{ marginTop: 10 }}>
        <div>
          <label htmlFor={`rule${r.id}`}>Rule broken (needed to hide or remove)</label>
          <select id={`rule${r.id}`} value={rule} onChange={(e) => setRule(e.target.value)}>
            <option value="">Choose a rule</option>
            {MODERATION_RULES.map((x) => (<option key={x} value={x}>{x}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor={`note${r.id}`}>Note (optional)</label>
          <input id={`note${r.id}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {err && <Msg kind="err">{err}</Msg>}
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {r.status === 'visible' && <button type="button" className="secondary" disabled={busy} onClick={() => act('hide')}>Hide</button>}
        {r.status !== 'removed' && <button type="button" className="secondary" disabled={busy} onClick={() => act('remove')}>Remove</button>}
        {r.status !== 'visible' && <button type="button" disabled={busy} onClick={() => act('restore')}>Restore</button>}
        <button type="button" className="ghost" disabled={busy} onClick={history}>History</button>
        {r.posting_banned
          ? <button type="button" className="ghost" disabled={busy} onClick={() => ban(false)}>Lift posting ban</button>
          : <button type="button" className="ghost" disabled={busy} onClick={() => ban(true)}>Ban from posting</button>}
      </div>
      {hist && (
        <ul className="small" style={{ marginTop: 8, paddingLeft: 18 }}>
          {hist.length === 0 && <li className="muted">No edits or moderation yet.</li>}
          {hist.map((h, i) => (<li key={i}>{when(h.at)}: {h.kind}. {h.detail}</li>))}
        </ul>
      )}
    </div>
  );
}

export function ReviewsPage() {
  const [status, setStatus] = useState<'visible' | 'hidden' | 'removed' | 'all'>('visible');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_reviews', { p_status: status, p_limit: 200 });
    if (error) return setErr(errText(error));
    setErr('');
    setRows((data ?? []) as Row[]);
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title="Reviews" sub="in30A reviews, newest first. Hide or remove only when a rule is broken." />
      <div className="toggle" role="group" aria-label="Which reviews" style={{ marginBottom: 14 }}>
        {(['visible', 'hidden', 'removed', 'all'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
        ))}
      </div>
      <p className="muted small">Never hide a review because it is negative. Plan and sponsor tier never affect reviews, stars or their order.</p>
      {err && <Msg kind="err">{err}</Msg>}
      {rows && rows.length === 0 && <Empty icon={<Star size={22} />} title="No reviews here yet" />}
      {(rows ?? []).map((r) => (<ReviewCard key={r.id} r={r} onDone={load} />))}
    </>
  );
}

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
type Report = { reporter: string; email: string | null; reason: string; note: string | null; counts: boolean; at: string; banned: boolean };
type Reported = {
  review_id: string; listing_id: string; listing_name: string; rating: number; comment: string | null; status: 'visible' | 'hidden' | 'removed';
  reviewer_id: string; reviewer_email: string | null; counted_reports: number; owner_reports: number; first_report_at: string; reports: Report[];
};

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

// Reviews with open reports, oldest first. Target: looked at within 24 hours.
function ReportedCard({ r, onDone }: { r: Reported; onDone: () => void }) {
  const [rule, setRule] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hours = Math.floor((Date.now() - new Date(r.first_report_at).getTime()) / 3600000);

  async function act(action: 'hide' | 'remove' | 'restore' | 'dismiss') {
    setErr('');
    if ((action === 'hide' || action === 'remove') && !rule) return setErr('Pick the rule this review breaks.');
    if (action === 'remove' && !window.confirm('Remove this review for good?')) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_moderate_review', { p_id: r.review_id, p_action: action, p_rule: rule || null, p_note: null });
    setBusy(false);
    if (error) return setErr(errText(error));
    onDone();
  }

  async function ban(user: string, label: string) {
    const reason = window.prompt(`Ban ${label} from posting, reviewing and reporting? Why? (saved in the audit log)`);
    if (!reason) return;
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_posting_ban', { p_user: user, p_ban: true, p_reason: reason });
    setBusy(false);
    if (error) return setErr(errText(error));
    onDone();
  }

  return (
    <div className="card">
      <div className="row spread">
        <strong>{r.listing_name}</strong>
        <span className={`badge ${r.status === 'visible' ? 'approved' : 'pending'}`}>{r.status === 'hidden' ? 'hidden after reports' : r.status}</span>
      </div>
      <div style={{ color: '#C88A1E', fontSize: '1.1rem', margin: '4px 0' }} aria-label={`${r.rating} stars`}>{stars(r.rating)}</div>
      {r.comment ? <p style={{ margin: '4px 0 8px' }}>{r.comment}</p> : <p className="muted small">No comment</p>}
      <p className="muted small" style={{ margin: 0 }}>
        By {r.reviewer_email ?? 'unknown'} · {r.counted_reports} counted {r.counted_reports === 1 ? 'report' : 'reports'}
        {r.owner_reports ? ` · ${r.owner_reports} from the business (not counted)` : ''} · first report {hours < 1 ? 'under an hour' : `${hours} h`} ago
        {hours >= 24 ? ' · OVER 24 HOURS' : ''}
      </p>
      <ul className="small" style={{ margin: '8px 0', paddingLeft: 18 }}>
        {r.reports.map((x, i) => (
          <li key={i}>
            {x.reason}{x.note ? `: "${x.note}"` : ''} · {x.email ?? 'account'}{x.counts ? '' : ' (business owner, not counted)'} · {when(x.at)}
            {x.banned ? ' · banned' : (
              <> · <button type="button" className="ghost" style={{ minHeight: 0, padding: 0 }} disabled={busy} onClick={() => ban(x.reporter, x.email ?? 'this reporter')}>ban reporter</button></>
            )}
          </li>
        ))}
      </ul>
      <label htmlFor={`rr${r.review_id}`}>Rule broken (needed to hide or remove)</label>
      <select id={`rr${r.review_id}`} value={rule} onChange={(e) => setRule(e.target.value)}>
        <option value="">Choose a rule</option>
        {MODERATION_RULES.map((x) => (<option key={x} value={x}>{x}</option>))}
      </select>
      {err && <Msg kind="err">{err}</Msg>}
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {r.status === 'hidden'
          ? <button type="button" disabled={busy} onClick={() => act('restore')}>Restore (breaks no rule)</button>
          : <button type="button" disabled={busy} onClick={() => act('dismiss')}>Keep up (breaks no rule)</button>}
        {r.status === 'visible' && <button type="button" className="secondary" disabled={busy} onClick={() => act('hide')}>Hide</button>}
        <button type="button" className="secondary" disabled={busy} onClick={() => act('remove')}>Remove</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => ban(r.reviewer_id, r.reviewer_email ?? 'the reviewer')}>Ban reviewer</button>
      </div>
    </div>
  );
}

function ReportedList() {
  const [rows, setRows] = useState<Reported[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_review_reports');
    if (error) return setErr(errText(error));
    setErr('');
    setRows((data ?? []) as Reported[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <p className="muted small">
        A review is hidden by itself after reports from 3 different accounts (reports from the business's own owner never count).
        Restoring or keeping it up closes its reports and starts the count again.
      </p>
      {err && <Msg kind="err">{err}</Msg>}
      {rows && rows.length === 0 && <Empty icon={<Star size={22} />} title="No open reports" />}
      {(rows ?? []).map((r) => (<ReportedCard key={r.review_id} r={r} onDone={load} />))}
    </>
  );
}

export function ReviewsPage() {
  const [status, setStatus] = useState<'reported' | 'visible' | 'hidden' | 'removed' | 'all'>('reported');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (status === 'reported') return;
    const { data, error } = await supabase.rpc('admin_reviews', { p_status: status, p_limit: 200 });
    if (error) return setErr(errText(error));
    setErr('');
    setRows((data ?? []) as Row[]);
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title="Reviews" sub="WhileIn reviews, newest first. Hide or remove only when a rule is broken." />
      <div className="toggle" role="group" aria-label="Which reviews" style={{ marginBottom: 14 }}>
        {(['reported', 'visible', 'hidden', 'removed', 'all'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
        ))}
      </div>
      <p className="muted small">Never hide a review because it is negative. Plan and sponsor tier never affect reviews, stars or their order.</p>
      {status === 'reported' ? <ReportedList /> : (
        <>
          {err && <Msg kind="err">{err}</Msg>}
          {rows && rows.length === 0 && <Empty icon={<Star size={22} />} title="No reviews here yet" />}
          {(rows ?? []).map((r) => (<ReviewCard key={r.id} r={r} onDone={load} />))}
        </>
      )}
    </>
  );
}

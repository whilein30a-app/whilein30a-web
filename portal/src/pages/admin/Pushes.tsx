import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Msg, errText, PageHeader } from '../../components';
import { centralToday, WINDOWS } from '../../plans';
import { supabase } from '../../supabase';

type Q = {
  deal_id: string; listing_id: string; listing_name: string; title: string; push_type: string; push_date: string;
  push_window: 'morning' | 'afternoon'; push_status: string; push_paid: boolean; review_status: string;
  push_recipients: number | null; push_sent_at: string | null;
};
type Log = { id: number; kind: string; title: string | null; body: string | null; audience: string | null; recipients: number; created_at: string };

async function fnError(error: any): Promise<string> {
  try {
    const j = await error?.context?.json?.();
    if (j?.error) return String(j.error);
  } catch { /* fall through */ }
  return error?.message ?? 'Something went wrong.';
}

function statusText(q: Q): string {
  if (q.push_status === 'sent') return `Sent to ${q.push_recipients ?? 0}`;
  if (q.push_status === 'scheduled') return 'Scheduled';
  if (q.review_status !== 'approved') return 'Waiting for deal approval';
  if ((q.push_type === 'single' || q.push_type === 'nearby') && !q.push_paid) return 'Waiting for payment';
  return 'Requested';
}

export function PushesPage() {
  const [queue, setQueue] = useState<Q[]>([]);
  const [log, setLog] = useState<Log[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'deals' | 'all'>('deals');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.rpc('admin_push_queue'),
      supabase.from('push_log').select('id,kind,title,body,audience,recipients,created_at').order('created_at', { ascending: false }).limit(30),
    ]);
    if (a.error) setErr(errText(a.error));
    setQueue((a.data ?? []) as Q[]);
    setLog((b.data ?? []) as Log[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(fn: string, args: Record<string, unknown>, ok: string) {
    setErr(''); setMsg('');
    const { error } = await supabase.rpc(fn, args);
    if (error) setErr(errText(error)); else setMsg(ok);
    load();
  }

  async function preview(e: FormEvent) {
    e.preventDefault();
    setErr(''); setMsg(''); setCount(null); setBusy(true);
    const { data, error } = await supabase.functions.invoke('admin-send-push', { body: { title, body, audience, dry: true } });
    setBusy(false);
    if (error) return setErr(await fnError(error));
    setCount((data as any)?.recipients ?? 0);
  }

  async function send() {
    setErr(''); setMsg(''); setBusy(true);
    const { data, error } = await supabase.functions.invoke('admin-send-push', { body: { title, body, audience } });
    setBusy(false);
    if (error) return setErr(await fnError(error));
    setMsg(`Sent to ${(data as any)?.sent ?? 0} devices.`);
    setCount(null); setTitle(''); setBody('');
    load();
  }

  // Next 14 days of windows, so open ones are easy to see.
  const days = Array.from({ length: 14 }, (_, i) => centralToday(i));
  const at = (d: string, w: string) => queue.find((q) => q.push_date === d && q.push_window === w && q.push_status !== 'sent');
  const upcoming = queue.filter((q) => q.push_date >= centralToday());
  const past = queue.filter((q) => q.push_date < centralToday());

  return (
    <>
      <PageHeader title="Pushes" sub="Booked windows, payments and announcements to the app" />
      {msg && <Msg kind="ok">{msg}</Msg>}
      {err && <Msg kind="err">{err}</Msg>}

      <h2>Booked windows, next 14 days</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Day</th><th>Morning</th><th>Afternoon</th></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td>{d}</td>
                {(['morning', 'afternoon'] as const).map((w) => {
                  const b = at(d, w);
                  return <td key={w}>{b ? <>{b.listing_name}<div className="muted small">{b.push_type}, {statusText(b)}</div></> : <span className="muted">Open</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Morning {WINDOWS.morning.replace('Morning, ', '')}. Afternoon {WINDOWS.afternoon.replace('Afternoon, ', '')}.</p>
      </div>

      <h2>Queue ({upcoming.length})</h2>
      {upcoming.length === 0 && <p className="muted">Nothing booked.</p>}
      {upcoming.map((q) => {
        const paid = q.push_type === 'single' || q.push_type === 'nearby';
        return (
          <div className="card" key={q.deal_id}>
            <div className="row spread">
              <strong>{q.listing_name}</strong>
              <span className="badge">{statusText(q)}</span>
            </div>
            <p style={{ margin: '6px 0' }}>{q.title}</p>
            <p className="muted small">{q.push_date}, {q.push_window} · {q.push_type}{paid ? (q.push_paid ? ' · paid' : ' · unpaid') : ''}</p>
            <div className="row">
              {paid && q.push_status !== 'sent' && (
                <button type="button" className="secondary" onClick={() => act('admin_mark_push_paid', { p_deal_id: q.deal_id, p_paid: !q.push_paid }, q.push_paid ? 'Marked unpaid.' : 'Marked paid.')}>
                  {q.push_paid ? 'Mark unpaid' : 'Mark paid'}
                </button>
              )}
              {q.push_status !== 'sent' && (
                <button type="button" className="secondary" onClick={() => act('portal_cancel_push', { p_deal_id: q.deal_id }, 'Push cancelled.')}>Cancel push</button>
              )}
            </div>
          </div>
        );
      })}
      {past.length > 0 && (
        <>
          <h2>Recent</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Day</th><th>Business</th><th>Type</th><th className="num">Sent to</th></tr></thead>
              <tbody>{past.map((q) => (<tr key={q.deal_id}><td>{q.push_date}</td><td>{q.listing_name}</td><td>{q.push_type}</td><td className="num">{q.push_recipients ?? 0}</td></tr>))}</tbody>
            </table>
          </div>
        </>
      )}

      <h2>Send a message to the app</h2>
      <form className="card" onSubmit={preview}>
        <p className="muted small" style={{ marginTop: 0 }}>For announcements. Limit of 3 broadcasts per hour. Deals are labeled "Sponsored".</p>
        <label htmlFor="bt">Title</label>
        <input id="bt" required minLength={3} maxLength={50} value={title} onChange={(e) => { setTitle(e.target.value); setCount(null); }} />
        <label htmlFor="bb">Message</label>
        <textarea id="bb" required minLength={3} maxLength={178} value={body} onChange={(e) => { setBody(e.target.value); setCount(null); }} />
        <label htmlFor="ba">Audience</label>
        <select id="ba" value={audience} onChange={(e) => { setAudience(e.target.value as 'deals' | 'all'); setCount(null); }}>
          <option value="deals">People with Sponsored deal alerts on</option>
          <option value="all">Everyone with notifications on</option>
        </select>
        <div className="row" style={{ marginTop: 16 }}>
          <button type="submit" className="secondary" disabled={busy}>Count recipients</button>
          {count !== null && (
            <button type="button" disabled={busy || count === 0} onClick={send}>Send to {count} {count === 1 ? 'device' : 'devices'}</button>
          )}
        </div>
      </form>

      <h2>History</h2>
      {log.length === 0 && <p className="muted">Nothing sent yet.</p>}
      {log.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>When</th><th>Kind</th><th>Title</th><th className="num">Sent to</th></tr></thead>
            <tbody>{log.map((l) => (<tr key={l.id}><td>{new Date(l.created_at).toLocaleString()}</td><td>{l.kind}</td><td>{l.title}</td><td className="num">{l.recipients}</td></tr>))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

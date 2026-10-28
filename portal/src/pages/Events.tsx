import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { NeedListing, Msg, errText, PageHeader } from '../components';
import { useListings } from '../listings';
import { PaidGate } from '../paid';
import { centralToday, fmtDate } from '../plans';
import { supabase } from '../supabase';

type Sub = {
  id: string; title: string; start_date: string; start_time: string | null; end_time: string | null;
  venue_name: string | null; town: string | null; address: string | null; ticket_url: string | null; category: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; review_note: string | null;
};

// The app shows times as "6:00 PM". The time picker works in 24 hours.
function to24(t: string | null): string {
  const m = (t ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]?\.?$/);
  if (!m) return /^\d{2}:\d{2}$/.test(t ?? '') ? (t as string) : '';
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
function to12(t: string): string {
  if (!/^\d{2}:\d{2}$/.test(t)) return '';
  const [h, mm] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const EMPTY = { title: '', venue: '', town: '', address: '', date: '', start: '', end: '', url: '', category: '' };
const STATUS: Record<Sub['status'], string> = { pending: 'Waiting for review', approved: 'Live', rejected: 'Needs changes', withdrawn: 'Withdrawn' };

function Body({ listingId }: { listingId: string }) {
  const { current } = useListings();
  const [subs, setSubs] = useState<Sub[]>([]);
  const [f, setF] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const today = centralToday();

  const load = useCallback(async () => {
    const { data } = await supabase.from('event_submissions')
      .select('id,title,start_date,start_time,end_time,venue_name,town,address,ticket_url,category,status,review_note')
      .eq('listing_id', listingId).neq('status', 'withdrawn').order('start_date', { ascending: true }).limit(50);
    setSubs((data ?? []) as Sub[]);
  }, [listingId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (editing) return;
    setF((p) => ({ ...p, venue: p.venue || current?.name || '', address: p.address || current?.address || '' }));
  }, [current, editing]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  function reset() {
    setEditing(null);
    setF({ ...EMPTY, venue: current?.name ?? '', address: current?.address ?? '' });
  }

  function edit(s: Sub) {
    setEditing(s.id); setErr(''); setOk('');
    setF({
      title: s.title, venue: s.venue_name ?? '', town: s.town ?? '', address: s.address ?? '', date: s.start_date,
      start: to24(s.start_time), end: to24(s.end_time), url: s.ticket_url ?? '', category: s.category ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(''); setOk('');
    if (f.start && f.end && f.end <= f.start) return setErr('The end time must be after the start time.');
    setBusy(true);
    const args = {
      p_title: f.title, p_venue_name: f.venue, p_town: f.town, p_address: f.address, p_start_date: f.date,
      p_start_time: to12(f.start), p_end_time: to12(f.end), p_ticket_url: f.url, p_category: f.category,
    };
    const { error } = editing
      ? await supabase.rpc('portal_update_event', { p_id: editing, ...args })
      : await supabase.rpc('portal_submit_event', { p_listing_id: listingId, ...args });
    setBusy(false);
    if (error) return setErr(errText(error));
    setOk(editing
      ? 'Changes sent for review. If the event is already live, the old version stays up until the change is approved.'
      : 'Sent for review. It appears in the app once approved.');
    reset();
    load();
  }

  async function withdraw(s: Sub) {
    if (!window.confirm(`Withdraw "${s.title}"? It is removed from the app.`)) return;
    setErr(''); setOk('');
    const { error } = await supabase.rpc('portal_withdraw_event', { p_id: s.id });
    if (error) return setErr(errText(error));
    setOk('Event withdrawn.');
    if (editing === s.id) reset();
    load();
  }

  return (
    <>
      <form className="card" onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>{editing ? 'Edit event' : 'New event'}</h2>
        <label htmlFor="t">Title</label>
        <input id="t" required minLength={3} maxLength={100} value={f.title} onChange={set('title')} />
        <label htmlFor="d">Date</label>
        <input id="d" type="date" required min={today} value={f.date} onChange={set('date')} />
        <div className="row">
          <div style={{ flex: 1 }}><label htmlFor="s">Starts</label><input id="s" type="time" value={f.start} onChange={set('start')} /></div>
          <div style={{ flex: 1 }}><label htmlFor="e">Ends</label><input id="e" type="time" value={f.end} onChange={set('end')} /></div>
        </div>
        <label htmlFor="v">Venue</label>
        <input id="v" maxLength={100} value={f.venue} onChange={set('venue')} />
        <label htmlFor="a">Address</label>
        <input id="a" maxLength={200} value={f.address} onChange={set('address')} />
        <label htmlFor="tw">Town</label>
        <input id="tw" maxLength={60} value={f.town} onChange={set('town')} />
        <label htmlFor="c">Category</label>
        <input id="c" maxLength={40} placeholder="Live music" value={f.category} onChange={set('category')} />
        <label htmlFor="u">Ticket or info link (optional)</label>
        <input id="u" type="url" placeholder="https://" maxLength={300} value={f.url} onChange={set('url')} />
        {err && <Msg kind="err">{err}</Msg>}
        {ok && <Msg kind="ok">{ok}</Msg>}
        <div className="row" style={{ marginTop: 18 }}>
          <button type="submit" disabled={busy}>{busy ? 'Sending...' : editing ? 'Send changes for review' : 'Submit for review'}</button>
          {editing && <button type="button" className="secondary" onClick={reset}>Cancel</button>}
        </div>
      </form>

      <h2>Your events</h2>
      {subs.length === 0 && <p className="muted">Nothing yet.</p>}
      {subs.map((s) => {
        const past = s.start_date < today;
        return (
          <div className="card" key={s.id} style={past ? { opacity: 0.7 } : undefined}>
            <div className="row spread"><strong>{s.title}</strong><span className={`badge ${s.status === 'approved' ? 'approved' : s.status}`}>{past && s.status === 'approved' ? 'Over' : STATUS[s.status]}</span></div>
            <p className="muted small">{fmtDate(s.start_date)}{s.start_time ? `, ${s.start_time}` : ''}{s.end_time ? ` to ${s.end_time}` : ''}{s.venue_name ? ` · ${s.venue_name}` : ''}</p>
            {s.review_note && s.status === 'rejected' && <Msg kind="err">{s.review_note}</Msg>}
            {!past && (
              <div className="row">
                <button type="button" className="secondary" onClick={() => edit(s)}>Edit</button>
                <button type="button" className="ghost" onClick={() => withdraw(s)}>Withdraw</button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function EventsPage() {
  return (
    <>
      <PageHeader title="Events" sub="Add what's on so visitors find it in Events" />
      <NeedListing>{(id) => <PaidGate what="Events"><Body listingId={id} /></PaidGate>}</NeedListing>
    </>
  );
}

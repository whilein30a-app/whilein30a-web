import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { NeedListing, Msg, errText } from '../components';
import { useListings } from '../listings';
import { supabase } from '../supabase';

type Sub = { id: string; title: string; start_date: string; status: 'pending' | 'approved' | 'rejected'; review_note: string | null };

function Body({ listingId }: { listingId: string }) {
  const { current } = useListings();
  const [subs, setSubs] = useState<Sub[]>([]);
  const [f, setF] = useState({ title: '', venue: '', town: '', address: '', date: '', start: '', end: '', url: '', category: '' });
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('event_submissions').select('id,title,start_date,status,review_note')
      .eq('listing_id', listingId).order('created_at', { ascending: false }).limit(30);
    setSubs((data ?? []) as Sub[]);
  }, [listingId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setF((p) => ({ ...p, venue: p.venue || current?.name || '', address: p.address || current?.address || '' })); }, [current]);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(''); setOk(''); setBusy(true);
    const { error } = await supabase.rpc('portal_submit_event', {
      p_listing_id: listingId, p_title: f.title, p_venue_name: f.venue, p_town: f.town, p_address: f.address,
      p_start_date: f.date, p_start_time: f.start, p_end_time: f.end, p_ticket_url: f.url, p_category: f.category,
    });
    setBusy(false);
    if (error) return setErr(errText(error));
    setOk('Sent for review. It appears in the app once approved.');
    setF((p) => ({ ...p, title: '', date: '', start: '', end: '', url: '', category: '' }));
    load();
  }

  return (
    <>
      <form className="card" onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>New event</h2>
        <label htmlFor="t">Title</label>
        <input id="t" required minLength={3} maxLength={100} value={f.title} onChange={set('title')} />
        <label htmlFor="d">Date</label>
        <input id="d" type="date" required value={f.date} onChange={set('date')} />
        <div className="row">
          <div style={{ flex: 1 }}><label htmlFor="s">Starts</label><input id="s" maxLength={20} placeholder="6:00 PM" value={f.start} onChange={set('start')} /></div>
          <div style={{ flex: 1 }}><label htmlFor="e">Ends</label><input id="e" maxLength={20} placeholder="9:00 PM" value={f.end} onChange={set('end')} /></div>
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
        <div style={{ marginTop: 18 }}><button type="submit" disabled={busy}>{busy ? 'Sending...' : 'Submit for review'}</button></div>
      </form>

      <h2>Submitted events</h2>
      {subs.length === 0 && <p className="muted">Nothing yet.</p>}
      {subs.map((s) => (
        <div className="card" key={s.id}>
          <div className="row spread"><strong>{s.title}</strong><span className={`badge ${s.status}`}>{s.status}</span></div>
          <p className="muted small">{s.start_date}</p>
          {s.review_note && <Msg kind="err">{s.review_note}</Msg>}
        </div>
      ))}
    </>
  );
}

export function EventsPage() {
  return (
    <>
      <h1>Events</h1>
      <NeedListing>{(id) => <Body listingId={id} />}</NeedListing>
    </>
  );
}

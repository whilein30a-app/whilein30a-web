import { useCallback, useEffect, useState } from 'react';

import { Msg, errText, PageHeader } from '../../components';
import { useListings } from '../../listings';
import { supabase } from '../../supabase';

type AppRow = { id: string; business_name: string; contact_name: string | null; phone: string | null; claim_listing_id: string | null; new_listing: Record<string, string> | null; notes: string | null };
type DealRow = { id: string; listing_name: string; title: string; discount_text: string; valid_until: string | null; push_type: string; push_date: string | null; push_window: string | null };
type EventRow = { id: string; listing_id: string; title: string; venue_name: string | null; start_date: string; start_time: string | null; ticket_url: string | null };

function Actions({ onDo }: { onDo: (approve: boolean, note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (a: boolean) => {
    if (!a && !note.trim()) return;
    setBusy(true);
    await onDo(a, note);
    setBusy(false);
  };
  return (
    <>
      <input placeholder="Reason (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" disabled={busy} onClick={() => run(true)}>Approve</button>
        <button type="button" className="secondary" disabled={busy || !note.trim()} onClick={() => run(false)}>Reject</button>
      </div>
    </>
  );
}

export function ReviewPage() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const { reload } = useListings();

  const load = useCallback(async () => {
    const [a, d, e] = await Promise.all([
      supabase.from('business_applications').select('id,business_name,contact_name,phone,claim_listing_id,new_listing,notes').eq('status', 'pending').order('created_at'),
      supabase.rpc('admin_pending_deals'),
      supabase.from('event_submissions').select('id,listing_id,title,venue_name,start_date,start_time,ticket_url').eq('status', 'pending').order('created_at'),
    ]);
    setApps((a.data ?? []) as AppRow[]);
    setDeals((d.data ?? []) as DealRow[]);
    setEvents((e.data ?? []) as EventRow[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function review(fn: string, args: Record<string, unknown>, done?: string) {
    setErr(''); setOk('');
    const { error } = await supabase.rpc(fn, args);
    if (error) setErr(errText(error));
    else if (done) setOk(done);
    load();
    // If you approved your own application, your business appears right away.
    reload();
  }

  return (
    <>
      <PageHeader title="Review queue" sub="Business claims, deals and events waiting for approval" />
      <p className="muted">New business claims, deals and events wait here. Nothing shows in the app until you approve it.</p>
      {err && <Msg kind="err">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}

      <h2>Business applications ({apps.length})</h2>
      {apps.length === 0 && <p className="muted">Nothing waiting.</p>}
      {apps.map((a) => (
        <div className="card" key={a.id}>
          <strong>{a.business_name}</strong>
          <p className="muted small">{a.claim_listing_id ? 'Claims an existing listing' : `New listing: ${a.new_listing?.category ?? ''} ${a.new_listing?.address ?? ''}`}</p>
          <p className="small">{[a.contact_name, a.phone].filter(Boolean).join(' · ')}</p>
          {a.notes && <p className="small">{a.notes}</p>}
          <Actions onDo={(yes, note) => review('admin_review_application', { p_id: a.id, p_approve: yes, p_note: note },
            yes
              ? `Approved. The person who applied now manages ${a.business_name}. When they sign in, their Dashboard shows its stats and they can edit the listing and post deals and events. To give it a plan, open Admin > Plans and slots.`
              : `Rejected. The applicant sees your reason on their Add a business page.`)} />
        </div>
      ))}

      <h2>Deals ({deals.length})</h2>
      {deals.length === 0 && <p className="muted">Nothing waiting.</p>}
      {deals.map((d) => (
        <div className="card" key={d.id}>
          <strong>{d.title}</strong> <span className="muted small">{d.listing_name}</span>
          <p style={{ margin: '6px 0' }}>{d.discount_text}</p>
          <p className="muted small">{d.valid_until ? `Until ${d.valid_until}` : 'No end date'}{d.push_type !== 'none' && d.push_date ? ` · push: ${d.push_type}, ${d.push_date}, ${d.push_window}${d.push_type === 'single' || d.push_type === 'nearby' ? ' (needs payment)' : ''}` : ''}</p>
          <Actions onDo={(yes, note) => review('admin_review_deal', { p_deal_id: d.id, p_approve: yes, p_note: note },
            yes ? 'Deal approved. It is live in the app now. A booked push is scheduled once it is paid, or right away for Spotlight.' : 'Deal rejected. The business sees your reason.')} />
        </div>
      ))}

      <h2>Events ({events.length})</h2>
      {events.length === 0 && <p className="muted">Nothing waiting.</p>}
      {events.map((ev) => (
        <div className="card" key={ev.id}>
          <strong>{ev.title}</strong>
          <p className="muted small">{ev.start_date} {ev.start_time ?? ''} · {ev.venue_name ?? ''}</p>
          <Actions onDo={(yes, note) => review('admin_review_event', { p_id: ev.id, p_approve: yes, p_note: note },
            yes ? 'Event approved. It shows in Events in the app now.' : 'Event rejected. The business sees your reason.')} />
        </div>
      ))}
    </>
  );
}

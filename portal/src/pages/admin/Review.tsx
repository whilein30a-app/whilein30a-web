import { useCallback, useEffect, useState } from 'react';

import { Msg, errText, PageHeader } from '../../components';
import { useListings } from '../../listings';
import { supabase } from '../../supabase';

type AppRow = {
  id: string; business_name: string; contact_name: string | null; phone: string | null; email: string | null; notes: string | null;
  claim_listing_id: string | null; claim_address: string | null; claim_has_pin: boolean | null; claim_subcategory: string | null;
  new_listing: Record<string, string> | null; created_at: string;
};
type PlanReq = { id: string; listing_name: string; plan: string; billing: string; created_at: string; email: string | null };
type Sub = { name: string; category: string };
type Pin = { lat: string; lng: string; noPin: boolean; sub: string };
type DealRow = { id: string; listing_name: string; title: string; discount_text: string; valid_until: string | null; push_type: string; push_date: string | null; push_window: string | null };
type EventRow = { id: string; listing_id: string; title: string; venue_name: string | null; start_date: string; start_time: string | null; ticket_url: string | null };

function Actions({ onDo, blocked }: { onDo: (approve: boolean, note: string) => Promise<void>; blocked?: string }) {
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
      {blocked && <p className="muted small" style={{ margin: '0 0 8px' }}>{blocked}</p>}
      <input placeholder="Reason (required to reject)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" disabled={busy || !!blocked} onClick={() => run(true)}>Approve</button>
        <button type="button" className="secondary" disabled={busy || !note.trim()} onClick={() => run(false)}>Reject</button>
      </div>
    </>
  );
}

function PinEditor({ address, value, onChange, hasPin }: { address: string; value: Pin; onChange: (p: Pin) => void; hasPin?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function find() {
    setBusy(true); setMsg('');
    const { data, error } = await supabase.functions.invoke('geocode-address', { body: { address } });
    setBusy(false);
    if (error || !data || (data as { error?: string }).error) {
      let why = (data as { error?: string } | null)?.error ?? 'Could not look that address up.';
      try {
        const ctx = (error as unknown as { context?: Response } | null)?.context;
        if (ctx) why = (await ctx.json())?.error ?? why;
      } catch { /* keep the default message */ }
      return setMsg(why + ' You can type the latitude and longitude yourself (right-click the spot in Google Maps and copy the numbers).');
    }
    const d = data as { lat: number; lng: number; formatted: string };
    onChange({ ...value, lat: String(d.lat), lng: String(d.lng), noPin: false });
    setMsg(`Found: ${d.formatted}. Check it, then approve.`);
  }
  return (
    <div style={{ background: 'var(--soft, #f4f8f8)', borderRadius: 10, padding: 12, margin: '10px 0' }}>
      <strong className="small">Map pin {hasPin ? '(already set, leave blank to keep it)' : '(required)'}</strong>
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="secondary" disabled={busy || !address} onClick={find}>{busy ? 'Looking...' : 'Find pin from address'}</button>
        <input style={{ width: 130 }} aria-label="Latitude" placeholder="Latitude" value={value.lat} onChange={(e) => onChange({ ...value, lat: e.target.value, noPin: false })} />
        <input style={{ width: 130 }} aria-label="Longitude" placeholder="Longitude" value={value.lng} onChange={(e) => onChange({ ...value, lng: e.target.value, noPin: false })} />
        {value.lat && value.lng && (
          <a className="small" href={`https://www.google.com/maps?q=${encodeURIComponent(value.lat + ',' + value.lng)}`} target="_blank" rel="noopener noreferrer">Check on map</a>
        )}
      </div>
      {!hasPin && (
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={value.noPin} onChange={(e) => onChange({ ...value, noPin: e.target.checked, lat: e.target.checked ? '' : value.lat, lng: e.target.checked ? '' : value.lng })} />
          <span>No street address (mobile service). Listed everywhere except the map.</span>
        </label>
      )}
      {msg && <p className="small" style={{ margin: '6px 0 0' }}>{msg}</p>}
    </div>
  );
}

export function ReviewPage() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [reqs, setReqs] = useState<PlanReq[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [pins, setPins] = useState<Record<string, Pin>>({});
  const { reload } = useListings();
  const pinOf = (id: string): Pin => pins[id] ?? { lat: '', lng: '', noPin: false, sub: '' };

  const load = useCallback(async () => {
    const [a, d, e] = await Promise.all([
      supabase.rpc('admin_pending_applications'),
      supabase.rpc('admin_pending_deals'),
      supabase.from('event_submissions').select('id,listing_id,title,venue_name,start_date,start_time,ticket_url').eq('status', 'pending').order('created_at'),
    ]);
    setApps((a.data ?? []) as AppRow[]);
    supabase.rpc('admin_open_plan_requests').then(({ data }) => setReqs((data ?? []) as PlanReq[]));
    supabase.from('subcategories').select('name,category').order('category').order('sort').then(({ data }) => setSubs((data ?? []) as Sub[]));
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
      {apps.map((a) => {
        const nl = a.new_listing;
        const pin = pinOf(a.id);
        const isNew = !a.claim_listing_id;
        const hasPin = isNew ? false : !!a.claim_has_pin;
        const pinSet = !!(pin.lat.trim() && pin.lng.trim());
        const latN = Number(pin.lat), lngN = Number(pin.lng);
        const pinBad = pinSet && (!Number.isFinite(latN) || !Number.isFinite(lngN) || Math.abs(latN) > 90 || Math.abs(lngN) > 180);
        const need = !hasPin && !pinSet && !pin.noPin;
        const blocked = pinBad ? 'The pin numbers are not valid.' : need ? 'Set the map pin before you can approve. Without one the place is hidden in the app.' : undefined;
        const category = nl?.category ?? '';
        const subOptions = subs.filter((x) => !category || x.category === category);
        return (
          <div className="card" key={a.id}>
            <div className="row spread"><strong>{a.business_name}</strong><span className="muted small">{new Date(a.created_at).toLocaleDateString()}</span></div>
            <p className="muted small">{isNew ? 'New listing' : 'Claims an existing listing'}</p>
            <p className="small">{[a.contact_name, a.phone, a.email].filter(Boolean).join(' · ')}</p>
            {isNew ? (
              <ul className="small" style={{ paddingLeft: 18 }}>
                <li>{nl?.category}{nl?.subcategory ? ` / ${nl.subcategory}` : ''}</li>
                <li>{nl?.address}</li>
                {nl?.website && <li>{nl.website}</li>}
                {nl?.description && <li>{nl.description}</li>}
              </ul>
            ) : (
              <p className="small">{a.claim_address ?? 'No address on file'}{a.claim_subcategory ? ` · ${a.claim_subcategory}` : ' · no subcategory yet'}</p>
            )}
            {a.notes && <p className="small">{a.notes}</p>}
            <PinEditor address={isNew ? nl?.address ?? '' : a.claim_address ?? ''} value={pin} hasPin={hasPin} onChange={(p) => setPins((m) => ({ ...m, [a.id]: p }))} />
            {(isNew || !a.claim_subcategory) && (
              <>
                <label htmlFor={`sub${a.id}`}>Subcategory</label>
                <select id={`sub${a.id}`} value={pin.sub || nl?.subcategory || ''} onChange={(e) => setPins((m) => ({ ...m, [a.id]: { ...pinOf(a.id), sub: e.target.value } }))}>
                  <option value="">None (auto-guess from the name)</option>
                  {subOptions.map((x) => (<option key={x.name} value={x.name}>{x.name}</option>))}
                </select>
              </>
            )}
            <Actions blocked={blocked} onDo={(yes, note) => review('admin_review_application', {
                p_id: a.id, p_approve: yes, p_note: note,
                p_lat: yes && pinSet ? latN : null, p_lng: yes && pinSet ? lngN : null,
                p_no_pin: yes && pin.noPin, p_subcategory: pin.sub || null,
              },
              yes
                ? `Approved. ${a.business_name} now has its pin and the applicant was emailed. To give it a plan, open Admin > Plans and slots.`
                : `Rejected. The applicant sees your reason on their Add a business page and by email.`)} />
          </div>
        );
      })}

      <h2>Plan requests ({reqs.length})</h2>
      {reqs.length === 0 && <p className="muted">Nothing waiting.</p>}
      {reqs.map((r) => (
        <div className="card" key={r.id}>
          <strong>{r.listing_name}</strong> wants <strong>{r.plan}</strong> <span className="muted small">billed by the {r.billing}</span>
          <p className="muted small">{r.email} · {new Date(r.created_at).toLocaleDateString()}. Send the payment link, then set the plan in Plans and slots.</p>
          <div className="row">
            <button type="button" onClick={() => review('admin_close_plan_request', { p_id: r.id, p_done: true }, 'Marked done.')}>Mark done</button>
            <button type="button" className="secondary" onClick={() => review('admin_close_plan_request', { p_id: r.id, p_done: false }, 'Dismissed.')}>Dismiss</button>
          </div>
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

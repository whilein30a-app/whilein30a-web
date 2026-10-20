import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../auth';
import { NeedListing, Msg, errText } from '../components';
import { useListings } from '../listings';
import { centralToday, money, payUrl, PLAN_NAME, PUSH_PRICE, useSetting, WINDOWS } from '../plans';
import { supabase } from '../supabase';

type PushType = 'none' | 'included' | 'single' | 'nearby';
type Deal = {
  id: string; title: string; discount_text: string; valid_until: string | null;
  is_active: boolean; review_status: 'pending' | 'approved' | 'rejected'; review_note: string | null;
  push_type: PushType; push_date: string | null; push_window: 'morning' | 'afternoon' | null;
  push_status: 'none' | 'requested' | 'scheduled' | 'sent' | 'cancelled'; push_paid: boolean;
  push_sent_at: string | null; push_recipients: number | null;
};
type Taken = { push_date: string; push_window: string };

const PUSH_LABEL: Record<PushType, string> = {
  none: 'No push notification',
  included: 'Included monthly push (Spotlight)',
  single: `Single push, ${money(PUSH_PRICE.single)}`,
  nearby: `Nearby push, ${money(PUSH_PRICE.nearby)}`,
};

function pushLine(d: Deal): string {
  if (d.push_type === 'none' || !d.push_date) return '';
  const when = `${d.push_date}, ${d.push_window === 'morning' ? 'morning' : 'afternoon'} window`;
  const st = d.push_status === 'sent' ? `sent to ${d.push_recipients ?? 0} people`
    : d.push_status === 'scheduled' ? 'scheduled'
    : d.push_status === 'cancelled' ? 'cancelled'
    : (d.push_type === 'single' || d.push_type === 'nearby') && !d.push_paid ? 'waiting for payment and approval' : 'waiting for approval';
  return `Push: ${when}, ${st}`;
}

function Body({ listingId }: { listingId: string }) {
  const { current } = useListings();
  const { session } = useAuth();
  const stripe = useSetting<Record<string, string>>('stripe_links').value ?? {};
  const plan = current?.plan ?? 'basic';
  const canPush = plan !== 'basic';

  const [deals, setDeals] = useState<Deal[]>([]);
  const [taken, setTaken] = useState<Taken[]>([]);
  const [usedIncluded, setUsedIncluded] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [until, setUntil] = useState('');
  const [pushType, setPushType] = useState<PushType>('none');
  const [pushDate, setPushDate] = useState('');
  const [pushWindow, setPushWindow] = useState<'morning' | 'afternoon'>('morning');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const today = centralToday();
  const editingDeal = deals.find((d) => d.id === editing) ?? null;
  const pushLocked = editingDeal?.push_status === 'sent';

  const load = useCallback(async () => {
    const [d, t] = await Promise.all([
      supabase.rpc('portal_my_deals', { p_listing_id: listingId }),
      supabase.rpc('push_windows_taken', { p_from: centralToday(), p_to: centralToday(120) }),
    ]);
    setDeals((d.data ?? []) as Deal[]);
    setTaken((t.data ?? []) as Taken[]);
  }, [listingId]);
  useEffect(() => { load(); }, [load]);

  // How many included pushes are already booked in the month being chosen.
  useEffect(() => {
    if (!pushDate) { setUsedIncluded(0); return; }
    supabase.rpc('included_pushes_used', { p_listing_id: listingId, p_month: pushDate }).then(({ data }) => {
      setUsedIncluded(typeof data === 'number' ? data : 0);
    });
  }, [listingId, pushDate, deals]);

  const isTaken = (date: string, w: string) =>
    taken.some((x) => x.push_date === date && x.push_window === w && !(editingDeal && editingDeal.push_date === date && editingDeal.push_window === w));

  function reset() {
    setEditing(null); setTitle(''); setText(''); setUntil('');
    setPushType('none'); setPushDate(''); setPushWindow('morning');
  }

  function edit(d: Deal) {
    setEditing(d.id); setTitle(d.title); setText(d.discount_text); setUntil(d.valid_until ?? '');
    const live = d.push_status === 'requested' || d.push_status === 'scheduled' || d.push_status === 'sent';
    setPushType(live ? d.push_type : 'none');
    setPushDate(live && d.push_date ? d.push_date : '');
    setPushWindow(d.push_window ?? 'morning');
    setErr(''); setOk('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(''); setOk('');
    if (pushType !== 'none' && !pushLocked) {
      if (!pushDate) return setErr('Choose a day for the push.');
      if (isTaken(pushDate, pushWindow)) return setErr('That day and time window is already booked. Pick another.');
    }
    setBusy(true);
    const { error } = await supabase.rpc('portal_save_deal', {
      p_listing_id: listingId, p_deal_id: editing, p_title: title, p_discount_text: text,
      p_valid_until: until || null,
      p_push_type: pushLocked ? 'none' : pushType,
      p_push_date: pushType === 'none' || pushLocked ? null : pushDate,
      p_push_window: pushType === 'none' || pushLocked ? null : pushWindow,
    });
    setBusy(false);
    if (error) return setErr(errText(error));
    setOk(pushType === 'single' || pushType === 'nearby'
      ? 'Sent for review. The push is scheduled once the deal is approved and the push is paid. Use the Pay button on the deal below.'
      : 'Sent for review. It goes live in the app once approved, usually within one business day.');
    reset();
    load();
  }

  async function toggle(d: Deal) {
    setErr(''); setOk('');
    const { error } = await supabase.rpc('portal_set_deal_active', { p_deal_id: d.id, p_active: !d.is_active });
    if (error) setErr(errText(error));
    load();
  }

  async function cancelPush(d: Deal) {
    setErr(''); setOk('');
    const { error } = await supabase.rpc('portal_cancel_push', { p_deal_id: d.id });
    if (error) setErr(errText(error));
    else setOk('Push cancelled. The window is free again.');
    load();
  }

  const types: PushType[] = plan === 'spotlight' ? ['none', 'included', 'single', 'nearby'] : ['none', 'single', 'nearby'];
  const includedLeft = Math.max(0, 1 - usedIncluded);

  return (
    <>
      <form className="card" onSubmit={save}>
        <h2 style={{ marginTop: 0 }}>{editing ? 'Edit deal' : 'New deal'}</h2>
        <label htmlFor="t">Title</label>
        <input id="t" required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="x">What guests get</label>
        <input id="x" required minLength={2} maxLength={160} placeholder="10% off lunch" value={text} onChange={(e) => setText(e.target.value)} />
        <label htmlFor="u">Last day (optional)</label>
        <input id="u" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />

        <h3 style={{ marginBottom: 0 }}>Push notification</h3>
        {!canPush ? (
          <p className="muted small">Pushes are part of Premium and above. Your plan is {PLAN_NAME[plan]}. <Link to="/plan">See plans</Link></p>
        ) : pushLocked ? (
          <p className="muted small">The push for this deal was already sent and cannot be changed.</p>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 4 }}>
              The app sends at most 2 sponsored pushes a day, one in each window. Booking is first come, first served. Pushes are labeled "Sponsored".
            </p>
            <label htmlFor="pt">Type</label>
            <select id="pt" value={pushType} onChange={(e) => setPushType(e.target.value as PushType)}>
              {types.map((t) => (<option key={t} value={t}>{PUSH_LABEL[t]}</option>))}
            </select>
            {pushType === 'nearby' && (
              <p className="muted small">Nearby sends only to people who opened the app within about 2 miles of your business in the last few hours.</p>
            )}
            {pushType === 'included' && (
              <p className="muted small">{includedLeft > 0 ? 'Your included push for that month is free.' : 'Your included push for that month is already booked.'}</p>
            )}
            {pushType !== 'none' && (
              <>
                <label htmlFor="pd">Day</label>
                <input id="pd" type="date" required min={today} max={centralToday(120)} value={pushDate} onChange={(e) => setPushDate(e.target.value)} />
                <label htmlFor="pw">Time window</label>
                <select id="pw" value={pushWindow} onChange={(e) => setPushWindow(e.target.value as 'morning' | 'afternoon')}>
                  {(Object.keys(WINDOWS) as Array<keyof typeof WINDOWS>).map((w) => (
                    <option key={w} value={w} disabled={!!pushDate && isTaken(pushDate, w)}>
                      {WINDOWS[w]}{pushDate && isTaken(pushDate, w) ? ' (booked)' : ''}
                    </option>
                  ))}
                </select>
              </>
            )}
          </>
        )}

        {err && <Msg kind="err">{err}</Msg>}
        {ok && <Msg kind="ok">{ok}</Msg>}
        <div className="row" style={{ marginTop: 18 }}>
          <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Submit for review'}</button>
          {editing && <button type="button" className="secondary" onClick={reset}>Cancel</button>}
        </div>
      </form>

      <h2>Your deals</h2>
      {deals.length === 0 && <p className="muted">No deals yet.</p>}
      {deals.map((d) => {
        const payBase = d.push_type === 'single' ? stripe.push_single : d.push_type === 'nearby' ? stripe.push_nearby : undefined;
        const pay = (d.push_type === 'single' || d.push_type === 'nearby') && !d.push_paid && (d.push_status === 'requested' || d.push_status === 'scheduled')
          ? payUrl(payBase, d.id, session?.user.email) : null;
        const cancellable = d.push_status === 'requested' || d.push_status === 'scheduled';
        return (
          <div className="card" key={d.id}>
            <div className="row spread">
              <strong>{d.title}</strong>
              <span className={`badge ${d.review_status}`}>{d.review_status === 'approved' ? (d.is_active ? 'Live' : 'Paused') : d.review_status}</span>
            </div>
            <p style={{ margin: '6px 0' }}>{d.discount_text}</p>
            <p className="muted small">{d.valid_until ? `Until ${d.valid_until}` : 'No end date'}</p>
            {pushLine(d) && <p className="muted small">{pushLine(d)}</p>}
            {d.review_note && <Msg kind="err">{d.review_note}</Msg>}
            <div className="row">
              <button type="button" className="secondary" onClick={() => edit(d)}>Edit</button>
              {d.review_status === 'approved' && (
                <button type="button" className="secondary" onClick={() => toggle(d)}>{d.is_active ? 'Pause' : 'Turn on'}</button>
              )}
              {pay && <a className="btn" href={pay} target="_blank" rel="noopener noreferrer">Pay for push</a>}
              {cancellable && <button type="button" className="secondary" onClick={() => cancelPush(d)}>Cancel push</button>}
            </div>
            {(d.push_type === 'single' || d.push_type === 'nearby') && !d.push_paid && cancellable && !pay && (
              <p className="muted small">Payment link not set up yet. We will send you one.</p>
            )}
          </div>
        );
      })}
      <p className="muted small">Edited deals go back to review before they show again. After a payment, we confirm it and the push is scheduled.</p>
    </>
  );
}

export function DealsPage() {
  return (
    <>
      <h1>Deals</h1>
      <NeedListing>{(id) => <Body listingId={id} />}</NeedListing>
    </>
  );
}

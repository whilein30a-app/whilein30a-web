import { useEffect, useState } from 'react';

import { Msg, errText } from '../../components';
import { PLAN_NAME, type PlanId } from '../../plans';
import { supabase } from '../../supabase';

type Data = {
  days: number; through: string;
  kinds: Record<string, { cur: number; prev: number }>;
  visitor_taps: { cur: number; prev: number };
  top_listings: Array<{ name: string; plan: PlanId; taps: number; views: number }>;
  by_source: Array<{ source: string; taps: number }>;
  series: Array<{ day: string; taps: number; views: number }>;
  plans: Record<string, number>;
  signups: { cur: number; prev: number; total: number };
  pushes: { sent: number; recipients: number };
  pending: { applications: number; deals: number; events: number };
};

const KIND: Record<string, string> = {
  detail_view: 'Listing views', impression: 'Impressions', call: 'Calls', directions: 'Directions', website: 'Website taps',
  deal_view: 'Deal views', deal_redeem: 'Deals redeemed', push_open: 'Push opens', booking_request: 'Booking requests',
};

function Change({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span className="muted small">no earlier data</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return <span className={pct >= 0 ? 'up' : 'down'}>{pct >= 0 ? '+' : ''}{pct}% vs earlier</span>;
}

function Tile({ label, cur, prev }: { label: string; cur: number; prev?: number }) {
  return (
    <div className="tile">
      <div className="n">{cur.toLocaleString()}</div>
      <div className="l">{label}</div>
      {prev !== undefined && <Change cur={cur} prev={prev} />}
    </div>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setD(null);
    supabase.rpc('admin_analytics', { p_days: days }).then(({ data, error }) => {
      if (error) return setErr(errText(error));
      setErr('');
      setD(data as Data);
    });
  }, [days]);

  const max = Math.max(1, ...(d?.series ?? []).map((s) => s.taps + s.views));

  return (
    <>
      <div className="row spread">
        <h1>Analytics</h1>
        <div className="row">
          {[7, 30, 90].map((n) => (
            <button key={n} type="button" className={days === n ? '' : 'secondary'} onClick={() => setDays(n)}>{n} days</button>
          ))}
        </div>
      </div>
      {err && <Msg kind="err">{err}</Msg>}
      {!d && !err && <p className="muted">Loading...</p>}
      {d && (
        <>
          <p className="muted small">Last {d.days} days through {d.through}. Counted overnight, so today is not included.</p>
          <div className="grid">
            <Tile label="Visitor taps (call, directions, website, deals)" cur={d.visitor_taps.cur} prev={d.visitor_taps.prev} />
            <Tile label="New sign-ups" cur={d.signups.cur} prev={d.signups.prev} />
            <Tile label="Total accounts" cur={d.signups.total} />
            <Tile label="Pushes sent" cur={d.pushes.sent} />
            <Tile label="Push recipients" cur={d.pushes.recipients} />
          </div>

          <h2>Activity per day</h2>
          <div className="card">
            <div className="bars" role="img" aria-label="Taps and views per day">
              {d.series.map((s) => (<div key={s.day} title={`${s.day}: ${s.taps} taps, ${s.views} views`} style={{ height: `${((s.taps + s.views) / max) * 100}%` }} />))}
            </div>
            {d.series.length === 0 && <p className="muted small">No data yet.</p>}
          </div>

          <h2>By type</h2>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>What</th><th className="num">Now</th><th className="num">Earlier</th></tr></thead>
              <tbody>
                {Object.keys(KIND).filter((k) => d.kinds[k]).map((k) => (
                  <tr key={k}><td>{KIND[k]}</td><td className="num">{d.kinds[k].cur.toLocaleString()}</td><td className="num">{d.kinds[k].prev.toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Top businesses</h2>
              {d.top_listings.length === 0 && <p className="muted small">No data yet.</p>}
              <table>
                <thead><tr><th>Business</th><th className="num">Taps</th><th className="num">Views</th></tr></thead>
                <tbody>
                  {d.top_listings.map((t) => (
                    <tr key={t.name}><td>{t.name}<div className="muted small">{PLAN_NAME[t.plan] ?? t.plan}</div></td><td className="num">{t.taps}</td><td className="num">{t.views}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Where taps come from</h2>
              {d.by_source.length === 0 && <p className="muted small">No data yet.</p>}
              <table>
                <tbody>{d.by_source.map((s) => (<tr key={s.source}><td>{s.source}</td><td className="num">{s.taps}</td></tr>))}</tbody>
              </table>
              <h2>Plans</h2>
              <table>
                <tbody>{(Object.keys(PLAN_NAME) as PlanId[]).map((p) => (<tr key={p}><td>{PLAN_NAME[p]}</td><td className="num">{d.plans[p] ?? 0}</td></tr>))}</tbody>
              </table>
              <h2>Waiting for review</h2>
              <table>
                <tbody>
                  <tr><td>Applications</td><td className="num">{d.pending.applications}</td></tr>
                  <tr><td>Deals</td><td className="num">{d.pending.deals}</td></tr>
                  <tr><td>Events</td><td className="num">{d.pending.events}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

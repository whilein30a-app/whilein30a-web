import { useEffect, useState } from 'react';

import { NeedListing, Msg, errText } from '../components';
import { supabase } from '../supabase';

type Stats = {
  kinds: Record<string, { cur: number; prev: number }>;
  visitor_taps: { cur: number; prev: number };
  best_day: { day: string; taps: number } | null;
  top_source: string | null;
  series: { day: string; taps: number; views: number }[];
  through: string;
};

const LABELS: Record<string, string> = {
  detail_view: 'Listing opened', impression: 'Seen in lists', call: 'Calls', directions: 'Directions',
  website: 'Website taps', deal_view: 'Deal views', deal_redeem: 'Deals redeemed', push_open: 'Push opens', booking_request: 'Booking requests',
};
const ORDER = ['detail_view', 'impression', 'call', 'directions', 'website', 'deal_view', 'deal_redeem', 'push_open', 'booking_request'];
const SOURCES: Record<string, string> = {
  home: 'Home screen', featured: 'Featured slot', category: 'Category lists', map: 'Map', search: 'Search', deal: 'Deals',
  ai: 'AI Concierge', push: 'Push notifications', area: 'Area guides', favorites: 'Saved places', photo_wall: 'Photo Wall', direct: 'Direct',
};

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev <= 0) return <span className="muted small">{cur > 0 ? 'New' : ''}</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="muted small">No change</span>;
  return <span className={pct > 0 ? 'up' : 'down'}>{pct > 0 ? '+' : ''}{pct}%</span>;
}

function Body({ listingId }: { listingId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    setStats(null);
    setErr('');
    supabase.rpc('portal_listing_stats', { p_listing_id: listingId }).then(({ data, error }) => {
      if (!live) return;
      if (error) setErr(errText(error));
      else setStats(data as Stats);
    });
    return () => { live = false; };
  }, [listingId]);

  if (err) return <Msg kind="err">{err}</Msg>;
  if (!stats) return <p className="muted">Loading...</p>;

  const max = Math.max(1, ...stats.series.map((s) => s.taps));
  const empty = stats.visitor_taps.cur === 0 && !stats.kinds.detail_view;

  return (
    <>
      <div className="grid">
        <div className="tile">
          <div className="n">{stats.visitor_taps.cur}</div>
          <div className="l">Visitor taps, last 30 days</div>
          <Delta cur={stats.visitor_taps.cur} prev={stats.visitor_taps.prev} />
        </div>
        <div className="tile">
          <div className="n">{stats.kinds.detail_view?.cur ?? 0}</div>
          <div className="l">Times your listing was opened</div>
          <Delta cur={stats.kinds.detail_view?.cur ?? 0} prev={stats.kinds.detail_view?.prev ?? 0} />
        </div>
        <div className="tile">
          <div className="n" style={{ fontSize: '1.3rem' }}>
            {stats.best_day ? new Date(stats.best_day.day + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'None yet'}
          </div>
          <div className="l">Best day{stats.best_day ? ` (${stats.best_day.taps} taps)` : ''}</div>
        </div>
        <div className="tile">
          <div className="n" style={{ fontSize: '1.3rem' }}>{stats.top_source ? SOURCES[stats.top_source] ?? stats.top_source : 'None yet'}</div>
          <div className="l">Top source of taps</div>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: 10 }}>
        Visitor taps are calls, directions, website taps and deal views. Compared with the 30 days before. Updated nightly, through {stats.through}.
      </p>

      {empty && <Msg kind="ok">No activity recorded yet. Numbers appear the morning after people use your listing.</Msg>}

      <h2>Taps per day</h2>
      <div className="card">
        <div className="bars" aria-label="Visitor taps per day, last 30 days">
          {stats.series.map((s) => (
            <div key={s.day} title={`${s.day}: ${s.taps} taps`} style={{ height: `${Math.round((s.taps / max) * 100)}%` }} />
          ))}
        </div>
      </div>

      <h2>By type</h2>
      <div className="card">
        <table>
          <thead><tr><th>What people did</th><th className="num">Last 30 days</th><th className="num">Before</th><th className="num">Change</th></tr></thead>
          <tbody>
            {ORDER.filter((k) => stats.kinds[k]).map((k) => (
              <tr key={k}>
                <td>{LABELS[k]}</td>
                <td className="num">{stats.kinds[k].cur}</td>
                <td className="num muted">{stats.kinds[k].prev}</td>
                <td className="num"><Delta cur={stats.kinds[k].cur} prev={stats.kinds[k].prev} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Repeat taps by the same person within 30 minutes count once. Test devices and the in30A team are left out. We never see who anyone is.
      </p>
    </>
  );
}

export function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <NeedListing>{(id) => <Body listingId={id} />}</NeedListing>
    </>
  );
}

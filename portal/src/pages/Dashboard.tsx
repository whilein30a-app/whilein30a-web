import { CalendarDays, Eye, MousePointerClick, Navigation, Phone, Store, Tag, Trophy, TrendingUp } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { AreaChart, HBars } from '../charts';
import { Msg, NeedListing, PageHeader, Skeleton, errText } from '../components';
import { useListings } from '../listings';
import { supabase } from '../supabase';

type Stats = {
  kinds: Record<string, { cur: number; prev: number }>;
  visitor_taps: { cur: number; prev: number };
  best_day: { day: string; taps: number } | null;
  top_source: string | null;
  series: { day: string; taps: number; views: number }[];
  through: string;
  by_source?: { source: string; taps: number }[];
};

const LABELS: Record<string, string> = {
  detail_view: 'Listing opened', impression: 'Seen in lists', call: 'Calls', directions: 'Directions',
  website: 'Website taps', deal_view: 'Deal views', deal_redeem: 'Deals redeemed', push_open: 'Push opens', booking_request: 'Booking requests',
};
const ORDER = ['detail_view', 'impression', 'call', 'directions', 'website', 'deal_view', 'deal_redeem', 'push_open', 'booking_request'];
const SOURCES: Record<string, string> = {
  home: 'Home screen', featured: 'Featured slot', category: 'Category lists', map: 'Map', search: 'Search', deal: 'Deals',
  ai: 'Ask 30A', push: 'Push notifications', area: 'Area guides', favorites: 'Saved places', photo_wall: 'Photo Wall', direct: 'Direct',
  sponsor: 'Sponsor spots', deals_near_me: 'Deals Near Me',
};

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev <= 0) return <span className="muted small">{cur > 0 ? 'New this month' : 'No activity before'}</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="muted small">Same as the 30 days before</span>;
  return <span className={pct > 0 ? 'up' : 'down'}>{pct > 0 ? '+' : ''}{pct}% vs the 30 days before</span>;
}

function Tile({ icon, tone, value, label, children }: { icon: ReactNode; tone: string; value: ReactNode; label: string; children?: ReactNode }) {
  return (
    <div className="tile">
      <div className={`ic ${tone}`}>{icon}</div>
      <div className="n">{value}</div>
      <div className="l">{label}</div>
      {children}
    </div>
  );
}

function Body({ listingId }: { listingId: string }) {
  const { reload } = useListings();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState('');
  // If the listing was removed while this page was open, refresh the list once
  // instead of leaving "Not allowed" on screen.
  const refreshed = useRef(false);

  useEffect(() => {
    let live = true;
    setStats(null);
    setErr('');
    supabase.rpc('portal_listing_stats', { p_listing_id: listingId }).then(({ data, error }) => {
      if (!live) return;
      if (error) {
        if (!refreshed.current && /not allowed/i.test(error.message || '')) {
          refreshed.current = true;
          reload();
        }
        setErr(errText(error));
      } else setStats(data as Stats);
    });
    return () => { live = false; };
  }, [listingId]);

  if (err) return <Msg kind="err">{err}</Msg>;
  if (!stats) return <><Skeleton height={130} /><div style={{ height: 14 }} /><Skeleton height={260} /></>;

  const k = (name: string) => stats.kinds[name] ?? { cur: 0, prev: 0 };
  const empty = stats.visitor_taps.cur === 0 && !stats.kinds.detail_view;
  const sources = (stats.by_source ?? []).map((s) => ({ label: SOURCES[s.source] ?? s.source, value: s.taps }));

  return (
    <>
      {empty && <Msg kind="ok">No activity yet. Numbers appear the morning after people use your listing in the app.</Msg>}

      <div className="grid">
        <Tile icon={<MousePointerClick size={20} />} tone="teal" value={stats.visitor_taps.cur} label="Visitor taps">
          <Delta cur={stats.visitor_taps.cur} prev={stats.visitor_taps.prev} />
        </Tile>
        <Tile icon={<Eye size={20} />} tone="deep" value={k('detail_view').cur} label="Times your listing was opened">
          <Delta cur={k('detail_view').cur} prev={k('detail_view').prev} />
        </Tile>
        <Tile icon={<Phone size={20} />} tone="gold" value={k('call').cur} label="Calls">
          <Delta cur={k('call').cur} prev={k('call').prev} />
        </Tile>
        <Tile icon={<Navigation size={20} />} tone="teal" value={k('directions').cur} label="Directions">
          <Delta cur={k('directions').cur} prev={k('directions').prev} />
        </Tile>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="row spread">
            <h2 style={{ margin: 0 }}>Last 30 days</h2>
            <span className="muted small">Updated nightly, through {new Date(stats.through + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <AreaChart data={stats.series.map((s) => ({ day: s.day, a: s.taps, b: s.views }))} aLabel="Visitor taps" bLabel="Listing opened" />
          </div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <h2>Highlights</h2>
          <div className="row" style={{ alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
            <div className="ic gold" style={{ width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none' }}><Trophy size={19} /></div>
            <div>
              <strong>{stats.best_day ? new Date(stats.best_day.day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'No best day yet'}</strong>
              <div className="muted small">{stats.best_day ? `Your best day, with ${stats.best_day.taps} taps` : 'Shows once people start tapping'}</div>
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
            <div className="ic teal" style={{ width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none' }}><TrendingUp size={19} /></div>
            <div>
              <strong>{stats.top_source ? SOURCES[stats.top_source] ?? stats.top_source : 'No top source yet'}</strong>
              <div className="muted small">Where most of your taps came from</div>
            </div>
          </div>
          {sources.length > 1 && <div style={{ marginTop: 16 }}><HBars rows={sources} /></div>}
        </div>
      </div>

      <h2>Quick actions</h2>
      <div className="quick">
        <Link to="/deals"><span className="ic gold"><Tag size={18} /></span>Post a deal</Link>
        <Link to="/events"><span className="ic teal"><CalendarDays size={18} /></span>Add an event</Link>
        <Link to="/listing"><span className="ic deep"><Store size={18} /></span>Edit your listing</Link>
      </div>

      <h2>Everything people did</h2>
      <div className="card">
        <table>
          <thead><tr><th>What people did</th><th className="num">Last 30 days</th><th className="num">Before</th></tr></thead>
          <tbody>
            {ORDER.filter((n) => stats.kinds[n]).map((n) => (
              <tr key={n}>
                <td>{LABELS[n]}</td>
                <td className="num"><strong>{stats.kinds[n].cur}</strong></td>
                <td className="num muted">{stats.kinds[n].prev}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Visitor taps are calls, directions, website taps and deal views. Repeat taps by the same person within 30 minutes count once.
        Test devices and the in30A team are left out. We never see who anyone is.
      </p>
    </>
  );
}

export function DashboardPage() {
  const { current } = useListings();
  return (
    <>
      <PageHeader title={current ? current.name : 'Dashboard'} sub="How your listing did in the app over the last 30 days" />
      <NeedListing>{(id) => <Body listingId={id} />}</NeedListing>
    </>
  );
}

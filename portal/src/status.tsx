// Dashboard status cards and the setup checklist (portal walkthrough).
import { CalendarDays, CheckCircle2, Circle, Crown, MapPin, MessageSquareText, Star, Tag } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { PLAN_NAME, type PlanId } from './plans';
import { supabase } from './supabase';

export type ListingStatus = {
  plan: PlanId; plan_expires_on: string | null; limits_on: boolean; photo_count: number;
  has_hours: boolean; has_phone: boolean; has_description: boolean; has_logo: boolean; has_website: boolean;
  has_subcategory: boolean; has_pin: boolean; in_area: boolean;
  deals_live: number; deals_pending: number; deals_rejected: number;
  events_pending: number; events_upcoming: number; changes_pending: number; plan_request_open: boolean;
  reviews: { avg: number | null; count: number };
};

export function useListingStatus(listingId: string | undefined) {
  const [status, setStatus] = useState<ListingStatus | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!listingId) return;
    let live = true;
    supabase.rpc('portal_listing_status', { p_listing_id: listingId }).then(({ data }) => {
      if (live) setStatus((data as ListingStatus) ?? null);
    });
    return () => { live = false; };
  }, [listingId, n]);
  return { status, reload: () => setN((x) => x + 1) };
}

function Card({ icon, tone, title, children, to, link }: { icon: ReactNode; tone: string; title: string; children: ReactNode; to?: string; link?: string }) {
  return (
    <div className="tile">
      <div className={`ic ${tone}`}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{title}</div>
      <div className="l">{children}</div>
      {to && link && <Link to={to} className="small">{link}</Link>}
    </div>
  );
}

export function StatusCards({ status }: { status: ListingStatus }) {
  const paid = status.plan !== 'basic';
  const visible = status.in_area && status.has_pin;
  return (
    <div className="grid" style={{ marginBottom: 16 }}>
      <Card icon={<Crown size={20} />} tone="gold" title={PLAN_NAME[status.plan] ?? 'Basic'} to="/plan" link={paid ? 'Plan details' : 'See plans'}>
        {paid ? (status.plan_expires_on ? `Paid through ${status.plan_expires_on}` : 'Active') : 'Free listing'}
        {status.plan_request_open ? '. Plan request sent, we will email you.' : ''}
      </Card>
      <Card icon={<MapPin size={20} />} tone={visible ? 'teal' : 'deep'} title={visible ? 'Live in the app' : status.in_area ? 'Listed, no map pin' : 'Not shown in the app'} to="/listing" link="Your listing">
        {visible ? 'On the map and in lists.' : status.in_area ? 'Shows in lists and search, not on the map. Ask us to set the pin.' : 'Outside the 30A area. Email hello@in30a.app if that is wrong.'}
      </Card>
      <Card icon={<Tag size={20} />} tone="gold" title={`${status.deals_live} live ${status.deals_live === 1 ? 'deal' : 'deals'}`} to="/deals" link="Deals">
        {status.deals_pending ? `${status.deals_pending} waiting for review. ` : ''}{status.deals_rejected ? `${status.deals_rejected} need changes.` : paid ? '' : 'Premium and up.'}
      </Card>
      <Card icon={<CalendarDays size={20} />} tone="teal" title={`${status.events_upcoming} upcoming ${status.events_upcoming === 1 ? 'event' : 'events'}`} to="/events" link="Events">
        {status.events_pending ? `${status.events_pending} waiting for review.` : paid ? 'Nothing waiting.' : 'Premium and up.'}
      </Card>
      <Card icon={<Star size={20} />} tone="gold" title={status.reviews.count ? `${Number(status.reviews.avg).toFixed(1)} stars` : 'No reviews yet'} to="/listing" link="Get reviews">
        {status.reviews.count ? `${status.reviews.count} in30A ${status.reviews.count === 1 ? 'review' : 'reviews'}` : 'Print your QR code to ask customers.'}
      </Card>
      {status.changes_pending > 0 && (
        <Card icon={<MessageSquareText size={20} />} tone="deep" title={`${status.changes_pending} change ${status.changes_pending === 1 ? 'request' : 'requests'}`} to="/listing" link="See requests">
          Waiting for us. We email you when done.
        </Card>
      )}
    </div>
  );
}

export function SetupChecklist({ status }: { status: ListingStatus }) {
  const paid = status.plan !== 'basic' || !status.limits_on;
  const items: Array<{ done: boolean; label: string; to: string }> = [
    { done: status.photo_count > 0, label: 'Add a cover photo', to: '/listing' },
    { done: status.has_hours, label: 'Add your hours', to: '/listing' },
    { done: status.has_phone, label: 'Add your phone number', to: '/listing' },
    { done: status.has_subcategory, label: 'Check your category (ask us to change it)', to: '/listing' },
  ];
  if (paid) {
    items.push(
      { done: status.has_description, label: 'Write a short description', to: '/listing' },
      { done: status.has_logo, label: 'Upload your logo', to: '/listing' },
      { done: status.photo_count > 1, label: 'Add more photos to your gallery', to: '/listing' },
      { done: status.deals_live > 0 || status.deals_pending > 0, label: 'Post your first deal', to: '/deals' },
    );
  }
  items.push({ done: status.reviews.count > 0, label: 'Get your first review (print the QR code)', to: '/listing' });
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return (
    <div className="card">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Finish setting up</h2>
        <span className="muted small">{done} of {items.length} done</span>
      </div>
      <div style={{ background: 'var(--line)', height: 8, borderRadius: 4, margin: '10px 0 6px' }}>
        <div style={{ width: `${Math.round((done / items.length) * 100)}%`, background: 'var(--teal)', height: 8, borderRadius: 4 }} />
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((i) => (
          <li key={i.label} className="row" style={{ gap: 10, minHeight: 40 }}>
            {i.done ? <CheckCircle2 size={20} color="var(--green)" /> : <Circle size={20} color="var(--drift)" />}
            {i.done ? <span className="muted" style={{ textDecoration: 'line-through' }}>{i.label}</span> : <Link to={i.to}>{i.label}</Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}

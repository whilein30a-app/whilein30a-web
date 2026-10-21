import { AlertCircle, CheckCircle2, Gauge, Store } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from './auth';
import { useListings } from './listings';

/** The wave header every signed-in page opens with, same art as the app. */
export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Skeleton({ height = 120, count = 1 }: { height?: number; count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: 'grid', gap: 14 }}>
      {Array.from({ length: count }, (_, i) => (<div key={i} className="skeleton" style={{ height }} />))}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card empty">
      <div className="ic">{icon}</div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

// Everything that needs "which business am I looking at" goes through here.
// Switching business lives in the sidebar.
export function NeedListing({ children }: { children: (id: string) => ReactNode }) {
  const { current, loading } = useListings();
  const { isAdmin } = useAuth();
  if (loading) return <Skeleton height={110} count={2} />;
  if (!current && isAdmin) {
    return (
      <Empty icon={<Gauge size={26} />} title="This account is an admin" action={<Link className="btn" to="/admin">Open the review queue</Link>}>
        It does not manage a business, so there is nothing to show here. Approvals, plans, pushes and sponsors are under Admin in the menu.
      </Empty>
    );
  }
  if (!current) {
    return (
      <Empty icon={<Store size={26} />} title="Add your business to get started" action={<Link className="btn" to="/apply">Add your business</Link>}>
        Tell us which business is yours. We approve it within one business day, then you can edit the listing and post deals and events.
      </Empty>
    );
  }
  return <>{children(current.id)}</>;
}

export function Msg({ kind, children }: { kind: 'err' | 'ok'; children: ReactNode }) {
  return (
    <div className={`msg ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>
      {kind === 'err' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
      <div>{children}</div>
    </div>
  );
}

// Friendly text for database errors. The database raises plain sentences on
// purpose, so most of them can be shown as they are.
export function errText(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? 'Something went wrong.';
  if (/permission denied|row-level security/i.test(m)) return 'You do not have permission to do that.';
  return m;
}

import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useListings } from './listings';

// Everything that needs "which business am I looking at" goes through here.
export function NeedListing({ children }: { children: (id: string) => ReactNode }) {
  const { current, listings, select, loading } = useListings();
  if (loading) return <p className="muted">Loading...</p>;
  if (!current) {
    return (
      <div className="card">
        <h1>Welcome to in30A Business</h1>
        <p>You do not have a business here yet. Tell us which business is yours and we will approve it, usually within one business day.</p>
        <Link className="btn" to="/apply">Add your business</Link>
      </div>
    );
  }
  return (
    <>
      {listings.length > 1 && (
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="muted small">Business</span>
          <select style={{ width: 'auto' }} value={current.id} onChange={(e) => select(e.target.value)}>
            {listings.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
          </select>
        </div>
      )}
      {children(current.id)}
    </>
  );
}

export function Msg({ kind, children }: { kind: 'err' | 'ok'; children: ReactNode }) {
  return <div className={`msg ${kind}`} role={kind === 'err' ? 'alert' : 'status'}>{children}</div>;
}

// Friendly text for database errors. The database raises plain sentences on
// purpose, so most of them can be shown as they are.
export function errText(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? 'Something went wrong.';
  if (/permission denied|row-level security/i.test(m)) return 'You do not have permission to do that.';
  return m;
}

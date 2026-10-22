import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useListings } from './listings';

/** Deals and events are Premium and above. Basic sees why, and how to upgrade, instead of a form that would be refused. */
export function PaidGate({ what, children }: { what: string; children: ReactNode }) {
  const { current } = useListings();
  if ((current?.plan ?? 'basic') !== 'basic') return <>{children}</>;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{what} are part of Premium and above</h2>
      <p className="muted">Your plan is Basic: name, address, map pin, phone and hours. Upgrade to post {what.toLowerCase()} that show in the app.</p>
      <Link className="btn" to="/plan">See plans</Link>
    </div>
  );
}

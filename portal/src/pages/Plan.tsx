import { useState } from 'react';

import { useAuth } from '../auth';
import { NeedListing } from '../components';
import { useListings } from '../listings';
import { money, payUrl, PLAN_BLURB, PLAN_NAME, PRICES, PUSH_PRICE, useSetting, type PlanId } from '../plans';

const PAID: Array<Exclude<PlanId, 'basic'>> = ['premium', 'featured', 'spotlight'];

function Body() {
  const { current } = useListings();
  const { session } = useAuth();
  const links = useSetting<Record<string, string>>('stripe_links').value ?? {};
  const [billing, setBilling] = useState<'month' | 'year'>('month');
  if (!current) return null;

  const tier: 'founding' | 'standard' = current.is_founding ? 'founding' : 'standard';
  const email = session?.user.email;
  const expires = current.plan_expires_on;

  return (
    <>
      <div className="card">
        <div className="row spread">
          <div>
            <div className="muted small">Current plan for {current.name}</div>
            <h2 style={{ margin: '2px 0' }}>{PLAN_NAME[current.plan]}{current.is_founding ? ' · Founding Partner' : ''}</h2>
            {current.plan !== 'basic' && (
              <div className="muted small">
                {current.billing === 'year' ? 'Yearly' : current.billing === 'month' ? 'Monthly' : ''}
                {expires ? ` · paid through ${expires}` : ''}
              </div>
            )}
          </div>
          <div className="row">
            <button type="button" className={billing === 'month' ? '' : 'secondary'} onClick={() => setBilling('month')}>Monthly</button>
            <button type="button" className={billing === 'year' ? '' : 'secondary'} onClick={() => setBilling('year')}>Yearly</button>
          </div>
        </div>
        {tier === 'founding'
          ? <p className="muted small">Founding Partner prices are locked for 2 years.</p>
          : <p className="muted small">Founding Partner prices are for our first 20 partners. Email hello@in30a.app to ask about a place.</p>}
      </div>

      <div className="grid">
        {PAID.map((p) => {
          const price = PRICES[tier][p][billing];
          const url = payUrl(links[`${p}_${tier}_${billing}`], current.id, email);
          const here = current.plan === p;
          return (
            <div className="tile" key={p}>
              <strong>{PLAN_NAME[p]}</strong>
              <div className="n">{money(price)}<span className="l"> /{billing === 'month' ? 'mo' : 'yr'}</span></div>
              <ul className="small" style={{ paddingLeft: 18 }}>
                {PLAN_BLURB[p].map((b) => (<li key={b}>{b}</li>))}
              </ul>
              {here ? <span className="badge approved">Your plan</span>
                : url ? <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Choose {PLAN_NAME[p]}</a>
                : <span className="muted small">Payment link coming soon. Email hello@in30a.app.</span>}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Basic (free)</h2>
        <p className="small">{PLAN_BLURB.basic.join(', ')}.</p>
        <h2>Single pushes</h2>
        <p className="small">Premium and Featured can buy single pushes: {money(PUSH_PRICE.single)} standard, {money(PUSH_PRICE.nearby)} Nearby. Book the day and time when you create a deal, then pay from the Deals page. Spotlight includes 1 push per month.</p>
      </div>
      <p className="muted small">After you pay, we confirm it and turn your plan on, usually within one business day. Featured and Spotlight depend on a free slot in your subcategory.</p>
    </>
  );
}

export function PlanPage() {
  return (
    <>
      <h1>Plan</h1>
      <NeedListing>{() => <Body />}</NeedListing>
    </>
  );
}

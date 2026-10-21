import { Check, Crown, Megaphone, Sparkles, Star } from 'lucide-react';
import { useState } from 'react';

import { useAuth } from '../auth';
import { NeedListing, PageHeader } from '../components';
import { useListings } from '../listings';
import { money, payUrl, PLAN_BLURB, PLAN_NAME, PRICES, PUSH_PRICE, useSetting, type PlanId } from '../plans';

const PAID: Array<Exclude<PlanId, 'basic'>> = ['premium', 'featured', 'spotlight'];
const ICON = { premium: <Star size={20} />, featured: <Sparkles size={20} />, spotlight: <Crown size={20} /> };
const TONE = { premium: 'teal', featured: 'gold', spotlight: 'deep' };

function Body() {
  const { current } = useListings();
  const { session } = useAuth();
  const links = useSetting<Record<string, string>>('stripe_links').value ?? {};
  const [billing, setBilling] = useState<'month' | 'year'>('month');
  if (!current) return null;

  const tier: 'founding' | 'standard' = current.is_founding ? 'founding' : 'standard';
  const email = session?.user.email;

  return (
    <>
      <div className="card row spread">
        <div>
          <div className="muted small">Your plan</div>
          <h2 style={{ margin: '2px 0' }}>{PLAN_NAME[current.plan]}{current.is_founding ? ', Founding Partner' : ''}</h2>
          <div className="muted small">
            {current.plan === 'basic'
              ? 'Free. Name, hours, address, map pin, tap to call and one photo.'
              : `${current.billing === 'year' ? 'Billed yearly' : 'Billed monthly'}${current.plan_expires_on ? `, paid through ${current.plan_expires_on}` : ''}`}
          </div>
        </div>
        <div className="toggle" role="group" aria-label="Billing">
          <button type="button" aria-pressed={billing === 'month'} onClick={() => setBilling('month')}>Monthly</button>
          <button type="button" aria-pressed={billing === 'year'} onClick={() => setBilling('year')}>Yearly, 2 months free</button>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 22 }}>
        {PAID.map((p) => {
          const price = PRICES[tier][p][billing];
          const url = payUrl(links[`${p}_${tier}_${billing}`], current.id, email);
          const here = current.plan === p;
          return (
            <div className={`card price ${p === 'featured' ? 'recommended' : ''}`} key={p} style={{ marginBottom: 0 }}>
              {p === 'featured' && <span className="flag">Most chosen</span>}
              <div className={`ic ${TONE[p]}`} style={{ width: 42, height: 42, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>{ICON[p]}</div>
              <h2 style={{ margin: '12px 0 2px' }}>{PLAN_NAME[p]}</h2>
              <div><span style={{ fontSize: '2rem', fontWeight: 700 }}>{money(price)}</span><span className="muted"> a {billing === 'month' ? 'month' : 'year'}</span></div>
              <ul>{PLAN_BLURB[p].map((b) => (<li key={b}><Check size={16} />{b}</li>))}</ul>
              {here ? <span className="badge approved">Your current plan</span>
                : url ? <a className="btn" style={{ width: '100%' }} href={url} target="_blank" rel="noopener noreferrer">Choose {PLAN_NAME[p]}</a>
                : <p className="muted small" style={{ margin: 0 }}>Online payment is coming soon. Email hello@in30a.app to start this plan.</p>}
            </div>
          );
        })}
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        {tier === 'founding'
          ? 'Founding Partner prices are locked for 2 years.'
          : 'Founding Partner prices are for our first 20 partners. Email hello@in30a.app to ask about a place.'}
        {' '}After you pay we turn your plan on, usually within one business day. Featured and Spotlight need a free slot in your subcategory.
      </p>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div className="ic gold" style={{ width: 42, height: 42, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none' }}><Megaphone size={20} /></div>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>Push notifications</h2>
            <p className="muted" style={{ margin: 0 }}>
              Premium and Featured can buy single pushes: {money(PUSH_PRICE.single)} to everyone with deal alerts on, or {money(PUSH_PRICE.nearby)} to
              people near your business. Spotlight includes one push a month. Book the day and time when you create a deal, then pay from the Deals page.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export function PlanPage() {
  return (
    <>
      <PageHeader title="Plan" sub="Choose how your business shows up in the app" />
      <NeedListing>{() => <Body />}</NeedListing>
    </>
  );
}

import { useEffect, useState, type FormEvent } from 'react';

import { Msg, errText, PageHeader } from '../../components';
import { PLAN_NAME, PRICES, PUSH_PRICE, money } from '../../plans';
import { supabase } from '../../supabase';

const PLANS = ['premium', 'featured', 'spotlight'] as const;
const TIERS = ['founding', 'standard'] as const;
const BILLS = ['month', 'year'] as const;

async function save(key: string, value: unknown) {
  return supabase.rpc('admin_set_setting', { p_key: key, p_value: value, p_public: true });
}

// W13: online payment with Stripe's embedded checkout.
function StripeOnlineCard() {
  const [pk, setPk] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key', 'stripe_publishable').maybeSingle()
      .then(({ data }) => setPk(((data?.value as { key?: string } | null)?.key) ?? ''));
    supabase.rpc('admin_stripe_prices').then(({ data }) => setPrices((data as Record<string, string>) ?? {}));
  }, []);
  const keys = [...TIERS.flatMap((t) => PLANS.flatMap((p) => BILLS.map((b) => `${p}_${t}_${b}`))), 'push_single', 'push_nearby'];
  const label = (k: string) => {
    if (k === 'push_single') return `Single push (${money(PUSH_PRICE.single)})`;
    if (k === 'push_nearby') return `Nearby push (${money(PUSH_PRICE.nearby)})`;
    const [p, t, b] = k.split('_') as [typeof PLANS[number], typeof TIERS[number], typeof BILLS[number]];
    return `${PLAN_NAME[p]}, ${t === 'founding' ? 'Founding' : 'Standard'}, ${b === 'month' ? 'monthly' : 'yearly'} (${money(PRICES[t][p][b])})`;
  };
  async function saveAll(e: FormEvent) {
    e.preventDefault();
    setErr(''); setMsg('');
    const key = pk.trim();
    if (key.startsWith('sk_') || key.startsWith('rk_')) { setErr('That is a secret key. Never paste it here. It goes only into Supabase secrets.'); return; }
    const clean: Record<string, string> = {};
    for (const k of keys) { const v = (prices[k] ?? '').trim(); if (v) clean[k] = v; }
    const a = await supabase.rpc('admin_save_stripe_prices', { p_prices: clean });
    if (a.error) return setErr(errText(a.error));
    const b = await supabase.rpc('admin_save_stripe_publishable', { p_key: key });
    if (b.error) return setErr(errText(b.error));
    setMsg(key ? `Saved. Online payment is on in ${key.startsWith('pk_live_') ? 'LIVE' : 'test'} mode.` : 'Saved. Online payment is off; the payment links below are used instead.');
  }
  const mode = pk.startsWith('pk_live_') ? 'Live' : pk.startsWith('pk_test_') ? 'Test mode' : 'Off';
  return (
    <form className="card" onSubmit={saveAll}>
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Online payment (Stripe)</h2>
        <span className={`badge ${mode === 'Off' ? 'pending' : 'approved'}`}>{mode}</span>
      </div>
      <p className="muted small">
        With a publishable key here, businesses pay by card on the Plan and Deals pages and plans switch on by themselves. Leave it empty
        to keep using the payment links below. Only the publishable key (pk_) goes here; the secret key and webhook secret go into Supabase
        secrets only. Paste each Stripe price ID (price_...); a plan without one shows the request button.
      </p>
      <label htmlFor="stripe_pk">Publishable key</label>
      <input id="stripe_pk" placeholder="pk_test_..." value={pk} onChange={(e) => setPk(e.target.value)} autoComplete="off" spellCheck={false} />
      <div className="grid" style={{ marginTop: 10 }}>
        {keys.map((k) => (
          <div key={k}>
            <label htmlFor={`price_${k}`}>{label(k)}</label>
            <input id={`price_${k}`} placeholder="price_..." value={prices[k] ?? ''} spellCheck={false}
              onChange={(e) => setPrices((x) => ({ ...x, [k]: e.target.value }))} />
          </div>
        ))}
      </div>
      {err && <Msg kind="err">{err}</Msg>}
      {msg && <Msg kind="ok">{msg}</Msg>}
      <div style={{ marginTop: 16 }}><button type="submit">Save online payment</button></div>
    </form>
  );
}

export function AdminSettingsPage() {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [enforce, setEnforce] = useState(false);
  const [morning, setMorning] = useState(11);
  const [afternoon, setAfternoon] = useState(16);
  const [radius, setRadius] = useState(2);
  const [fresh, setFresh] = useState(3);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [windowsRaw, setWindowsRaw] = useState<any>(null);
  const [nearbyRaw, setNearbyRaw] = useState<any>(null);
  const [seasonMode, setSeasonMode] = useState<'auto' | 'summer' | 'offSeason'>('auto');
  const [summerStart, setSummerStart] = useState('03-01');
  const [summerEnd, setSummerEnd] = useState('09-30');
  const [termsRaw, setTermsRaw] = useState<any>(null);
  const [termsVersion, setTermsVersion] = useState('');
  const [termsWas, setTermsWas] = useState('');
  const [revRaw, setRevRaw] = useState<any>(null);
  const [popSaves, setPopSaves] = useState(5);
  const [popDays, setPopDays] = useState(30);
  const [policyUrl, setPolicyUrl] = useState('https://in30a.app/review-policy');
  const [rateBase, setRateBase] = useState('');

  useEffect(() => {
    supabase.from('app_settings').select('key,value').then(({ data, error }) => {
      if (error) return setErr(errText(error));
      const m: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { m[r.key] = r.value; });
      setLinks(m.stripe_links ?? {});
      setEnforce(m.enforce_plan_limits?.on === true);
      setWindowsRaw(m.push_windows ?? null);
      setMorning(m.push_windows?.morning?.send_hour ?? 11);
      setAfternoon(m.push_windows?.afternoon?.send_hour ?? 16);
      setNearbyRaw(m.nearby ?? null);
      setRadius(m.nearby?.radius_miles ?? 2);
      setFresh(m.nearby?.fresh_hours ?? 3);
      setSeasonMode(m.transit_season?.mode ?? 'auto');
      setSummerStart(m.transit_season?.summer_start ?? '03-01');
      setSummerEnd(m.transit_season?.summer_end ?? '09-30');
      setTermsRaw(m.terms ?? null);
      setTermsVersion(m.terms?.version ?? '');
      setTermsWas(m.terms?.version ?? '');
      setRevRaw(m.reviews ?? null);
      setPopSaves(m.reviews?.popular_saves ?? 5);
      setPopDays(m.reviews?.popular_days ?? 30);
      setPolicyUrl(m.reviews?.policy_url ?? 'https://in30a.app/review-policy');
      setRateBase(m.reviews?.rate_link_base ?? '');
    });
  }, []);

  async function run(p: PromiseLike<{ error: any }>, ok: string) {
    setErr(''); setMsg('');
    const { error } = await p;
    if (error) setErr(errText(error)); else setMsg(ok);
  }

  function saveLinks(e: FormEvent) {
    e.preventDefault();
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(links)) {
      const t = v.trim();
      if (!t) continue;
      if (!/^https:\/\/[^\s]+$/i.test(t)) { setErr(`"${k}" must be an https link.`); return; }
      clean[k] = t;
    }
    run(save('stripe_links', clean), 'Stripe links saved. Businesses see them right away.');
  }

  function saveWindows(e: FormEvent) {
    e.preventDefault();
    const base = windowsRaw ?? { morning: { start: 10, end: 15 }, afternoon: { start: 15, end: 20 } };
    const next = {
      morning: { ...base.morning, send_hour: morning },
      afternoon: { ...base.afternoon, send_hour: afternoon },
    };
    run(save('push_windows', next), 'Send times saved.');
  }

  function saveNearby(e: FormEvent) {
    e.preventDefault();
    run(save('nearby', { ...(nearbyRaw ?? {}), radius_miles: radius, fresh_hours: fresh }), 'Nearby settings saved.');
  }

  function saveSeason(e: FormEvent) {
    e.preventDefault();
    if (seasonMode === 'auto' && (!/^\d{2}-\d{2}$/.test(summerStart) || !/^\d{2}-\d{2}$/.test(summerEnd))) {
      setErr('Pick both summer dates.'); return;
    }
    run(save('transit_season', { mode: seasonMode, summer_start: summerStart, summer_end: summerEnd }), 'Transit season saved. The app uses it the next time someone opens Transit.');
  }

  function saveTerms(e: FormEvent) {
    e.preventDefault();
    const v = termsVersion.trim();
    if (!v || v.length > 40) { setErr('Enter the Terms version, for example the "Last updated" date 2026-10-23.'); return; }
    if (v === termsWas) { setMsg('Nothing changed.'); return; }
    if (!window.confirm('Change the Terms version? Every app user and every business will be asked to agree again.')) return;
    const next = { terms_url: 'https://in30a.app/terms', privacy_url: 'https://in30a.app/privacy', ...(termsRaw ?? {}), version: v };
    run(save('terms', next), 'Terms version saved. Everyone is asked to agree to the new Terms the next time they open the app or the portal.');
    setTermsWas(v);
  }

  function saveReviews(e: FormEvent) {
    e.preventDefault();
    if (!/^https:\/\//i.test(policyUrl.trim())) { setErr('The review policy link must start with https://'); return; }
    if (rateBase.trim() && !/^https:\/\//i.test(rateBase.trim())) { setErr('The QR code address must start with https://, or be left blank.'); return; }
    const next = { ...(revRaw ?? {}), popular_saves: popSaves, popular_days: popDays, policy_url: policyUrl.trim(), rate_link_base: rateBase.trim() };
    run(save('reviews', next), 'Review settings saved.');
  }

  const setLink = (k: string, v: string) => setLinks((l) => ({ ...l, [k]: v }));

  return (
    <>
      <PageHeader title="App settings" sub="Payment links, plan limits, Terms version, transit season, push times and Nearby" />
      {msg && <Msg kind="ok">{msg}</Msg>}
      {err && <Msg kind="err">{err}</Msg>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Plan limits</h2>
        <p className="muted small">
          Off: every business keeps all features, and ranking by plan still applies. On: Basic listings lose the gallery, logo, links,
          deals and events. Turn this on at launch.
        </p>
        <label className="check">
          <input type="checkbox" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
          <span>Enforce plan limits</span>
        </label>
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => run(save('enforce_plan_limits', { on: enforce }), enforce ? 'Plan limits are on.' : 'Plan limits are off.')}>Save</button>
        </div>
      </div>

      <StripeOnlineCard />

      <form className="card" onSubmit={saveLinks}>
        <h2 style={{ marginTop: 0 }}>Stripe Payment Links</h2>
        <p className="muted small">Paste the https link for each product. The portal adds the business id so you can match the payment. Leave blank for "coming soon".</p>
        {TIERS.map((t) => (
          <div key={t}>
            <h3>{t === 'founding' ? 'Founding Partner' : 'Standard'}</h3>
            <div className="grid">
              {PLANS.flatMap((p) => BILLS.map((b) => {
                const k = `${p}_${t}_${b}`;
                return (
                  <div key={k}>
                    <label htmlFor={k}>{PLAN_NAME[p]}, {b === 'month' ? 'monthly' : 'yearly'} ({money(PRICES[t][p][b])})</label>
                    <input id={k} type="url" placeholder="https://buy.stripe.com/..." value={links[k] ?? ''} onChange={(e) => setLink(k, e.target.value)} />
                  </div>
                );
              }))}
            </div>
          </div>
        ))}
        <h3>Single pushes</h3>
        <div className="grid">
          <div>
            <label htmlFor="push_single">Single push ({money(PUSH_PRICE.single)})</label>
            <input id="push_single" type="url" placeholder="https://buy.stripe.com/..." value={links.push_single ?? ''} onChange={(e) => setLink('push_single', e.target.value)} />
          </div>
          <div>
            <label htmlFor="push_nearby">Nearby push ({money(PUSH_PRICE.nearby)})</label>
            <input id="push_nearby" type="url" placeholder="https://buy.stripe.com/..." value={links.push_nearby ?? ''} onChange={(e) => setLink('push_nearby', e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 16 }}><button type="submit">Save links</button></div>
      </form>

      <form className="card" onSubmit={saveTerms}>
        <h2 style={{ marginTop: 0 }}>Terms of Use version</h2>
        <p className="muted small">
          Every agreement is stored with this version and the date. When you publish new Terms at in30a.app/terms, change the version here
          (use the page's "Last updated" date). Every app user and every business is then asked once to agree before continuing.
        </p>
        <label htmlFor="tv">Current version</label>
        <input id="tv" maxLength={40} value={termsVersion} onChange={(e) => setTermsVersion(e.target.value)} placeholder="2026-10-23" />
        <div style={{ marginTop: 16 }}><button type="submit">Save</button></div>
      </form>

      <form className="card" onSubmit={saveReviews}>
        <h2 style={{ marginTop: 0 }}>Reviews</h2>
        <p className="muted small">"Popular on in30A" shows on places with no reviews yet that enough people saved recently.</p>
        <div className="grid">
          <div><label htmlFor="ps">Saves needed</label><input id="ps" type="number" min={1} max={100} value={popSaves} onChange={(e) => setPopSaves(Number(e.target.value))} /></div>
          <div><label htmlFor="pd">Within (days)</label><input id="pd" type="number" min={1} max={365} value={popDays} onChange={(e) => setPopDays(Number(e.target.value))} /></div>
        </div>
        <label htmlFor="pu">Review policy page</label>
        <input id="pu" type="url" value={policyUrl} onChange={(e) => setPolicyUrl(e.target.value)} />
        <label htmlFor="rb">QR code address (optional)</label>
        <input id="rb" type="url" placeholder="Blank uses this portal, for example https://portal.in30a.app/rate" value={rateBase} onChange={(e) => setRateBase(e.target.value)} />
        <p className="muted small">Codes already printed keep their old address, so set this before businesses print, ideally to a permanent address on in30a.app.</p>
        <div style={{ marginTop: 16 }}><button type="submit">Save</button></div>
      </form>

      <form className="card" onSubmit={saveSeason}>
        <h2 style={{ marginTop: 0 }}>Transit season</h2>
        <p className="muted small">
          Picks which park and ride schedule the app shows. Leave it on Automatic and the app switches by date every year. When the county
          announces a different start date, change the dates below, or force a season right away.
        </p>
        <label htmlFor="sm2">Schedule to show</label>
        <select id="sm2" value={seasonMode} onChange={(e) => setSeasonMode(e.target.value as 'auto' | 'summer' | 'offSeason')}>
          <option value="auto">Automatic, by the dates below</option>
          <option value="summer">Always summer</option>
          <option value="offSeason">Always off-season</option>
        </select>
        <div className="grid" style={{ marginTop: 8, opacity: seasonMode === 'auto' ? 1 : 0.5 }}>
          <div>
            <label htmlFor="ss">Summer starts (month and day)</label>
            <input id="ss" type="date" disabled={seasonMode !== 'auto'} value={`2000-${summerStart}`} onChange={(e) => e.target.value && setSummerStart(e.target.value.slice(5))} />
          </div>
          <div>
            <label htmlFor="se">Summer ends, last day (month and day)</label>
            <input id="se" type="date" disabled={seasonMode !== 'auto'} value={`2000-${summerEnd}`} onChange={(e) => e.target.value && setSummerEnd(e.target.value.slice(5))} />
          </div>
        </div>
        <p className="muted small">Only the month and day count, the year is ignored. Off-season runs from the day after summer ends until summer starts again. Routes that are not on a season's schedule are hidden in the app for that season.</p>
        <div style={{ marginTop: 16 }}><button type="submit">Save</button></div>
      </form>

      <form className="card" onSubmit={saveWindows}>
        <h2 style={{ marginTop: 0 }}>Push send times</h2>
        <p className="muted small">Hour (Central, 0 to 23) the booked push goes out. Morning must be inside 10 to 15 and afternoon inside 15 to 20.</p>
        <div className="grid">
          <div><label htmlFor="sm">Morning window</label><input id="sm" type="number" min={10} max={14} value={morning} onChange={(e) => setMorning(Number(e.target.value))} /></div>
          <div><label htmlFor="sa">Afternoon window</label><input id="sa" type="number" min={15} max={19} value={afternoon} onChange={(e) => setAfternoon(Number(e.target.value))} /></div>
        </div>
        <div style={{ marginTop: 16 }}><button type="submit">Save</button></div>
      </form>

      <form className="card" onSubmit={saveNearby}>
        <h2 style={{ marginTop: 0 }}>Nearby deals</h2>
        <div className="grid">
          <div><label htmlFor="nr">Distance (miles)</label><input id="nr" type="number" min={0.5} max={10} step={0.5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></div>
          <div><label htmlFor="nf">Opened the app within (hours)</label><input id="nf" type="number" min={1} max={24} value={fresh} onChange={(e) => setFresh(Number(e.target.value))} /></div>
        </div>
        <div style={{ marginTop: 16 }}><button type="submit">Save</button></div>
      </form>
    </>
  );
}

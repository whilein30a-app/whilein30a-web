import { useEffect, useState, type FormEvent } from 'react';

import { Msg, errText } from '../../components';
import { PLAN_NAME, PRICES, PUSH_PRICE, money } from '../../plans';
import { supabase } from '../../supabase';

const PLANS = ['premium', 'featured', 'spotlight'] as const;
const TIERS = ['founding', 'standard'] as const;
const BILLS = ['month', 'year'] as const;

async function save(key: string, value: unknown) {
  return supabase.rpc('admin_set_setting', { p_key: key, p_value: value, p_public: true });
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

  const setLink = (k: string, v: string) => setLinks((l) => ({ ...l, [k]: v }));

  return (
    <>
      <h1>Settings</h1>
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

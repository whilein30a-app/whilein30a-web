import { useEffect, useState, type FormEvent } from 'react';

import { Msg, errText, PageHeader } from '../components';
import { useAuth } from '../auth';
import { useListings } from '../listings';
import { MfaSettingsCard } from '../mfa';
import { supabase } from '../supabase';

export function SettingsPage() {
  const { session } = useAuth();
  const { listings } = useListings();
  const [reports, setReports] = useState<Record<string, boolean>>({});
  const [pw, setPw] = useState('');
  const [email, setEmail] = useState('');
  const [agreements, setAgreements] = useState<Array<{ kind: string; version: string; context: string; accepted_at: string }>>([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (!session) return;
    supabase.from('listing_owners').select('listing_id,email_reports').eq('user_id', session.user.id).then(({ data }) => {
      const m: Record<string, boolean> = {};
      (data ?? []).forEach((r: { listing_id: string; email_reports: boolean }) => { m[r.listing_id] = r.email_reports; });
      setReports(m);
    });
  }, [session]);

  async function toggle(listingId: string, on: boolean) {
    setErr(''); setOk('');
    setReports((p) => ({ ...p, [listingId]: on }));
    const { error } = await supabase.from('listing_owners').update({ email_reports: on })
      .eq('listing_id', listingId).eq('user_id', session!.user.id);
    if (error) { setErr(errText(error)); setReports((p) => ({ ...p, [listingId]: !on })); }
  }

  useEffect(() => {
    if (!session) return;
    supabase.from('terms_acceptances').select('kind,version,context,accepted_at').eq('user_id', session.user.id)
      .order('accepted_at', { ascending: false }).limit(10)
      .then(({ data }) => setAgreements((data ?? []) as typeof agreements));
  }, [session]);

  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    setErr(''); setOk('');
    const next = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) return setErr('Enter a valid email address.');
    const { error } = await supabase.auth.updateUser({ email: next }, { emailRedirectTo: `${window.location.origin}/settings` });
    if (error) return setErr(error.message);
    setEmail('');
    setOk(`Check ${next} and your current inbox. The change happens after you confirm the link we sent.`);
  }

  async function signOutEverywhere() {
    if (!window.confirm('Sign out on every device, including this one?')) return;
    await supabase.auth.signOut({ scope: 'global' });
  }

  async function changePw(e: FormEvent) {
    e.preventDefault();
    setErr(''); setOk('');
    if (pw.length < 10) return setErr('Use at least 10 characters.');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return setErr(error.message);
    setPw('');
    setOk('Password updated.');
  }

  return (
    <>
      <PageHeader title="Account settings" sub="Your sign-in, email, reports and agreements" />
      <MfaSettingsCard />
      <div className="card">
        <p className="muted small" style={{ marginTop: 0 }}>Signed in as {session?.user.email}</p>
        <h2 style={{ marginTop: 0 }}>Monthly email report</h2>
        {listings.length === 0 && <p className="muted">No businesses yet.</p>}
        {listings.map((l) => (
          <label className="check" key={l.id}>
            <input type="checkbox" checked={reports[l.id] ?? true} onChange={(e) => toggle(l.id, e.target.checked)} />
            <span>{l.name}</span>
          </label>
        ))}
      </div>
      <form className="card" onSubmit={changePw}>
        <h2 style={{ marginTop: 0 }}>Change password</h2>
        <label htmlFor="pw">New password</label>
        <input id="pw" type="password" autoComplete="new-password" minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <Msg kind="err">{err}</Msg>}
        {ok && <Msg kind="ok">{ok}</Msg>}
        <div style={{ marginTop: 18 }}><button type="submit">Update password</button></div>
      </form>
      <form className="card" onSubmit={changeEmail}>
        <h2 style={{ marginTop: 0 }}>Change sign-in email</h2>
        <p className="muted small">We send a confirmation link to the new address. Your businesses stay with your account.</p>
        <label htmlFor="em">New email</label>
        <input id="em" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div style={{ marginTop: 18 }}><button type="submit">Change email</button></div>
      </form>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your agreements</h2>
        {agreements.length === 0 ? <p className="muted small">None recorded yet.</p> : (
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            {agreements.map((a, i) => (
              <li key={i}>
                {a.kind === 'business' ? 'Business Listing Terms' : 'Terms of Use'}, version {a.version}, {a.context},{' '}
                {new Date(a.accepted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}><a href="https://whilein.app/terms" target="_blank" rel="noopener noreferrer">Read the Terms</a></p>
      </div>
      <div className="row">
        <button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
        <button type="button" className="ghost" onClick={signOutEverywhere}>Sign out on all devices</button>
      </div>
    </>
  );
}

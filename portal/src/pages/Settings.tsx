import { useEffect, useState, type FormEvent } from 'react';

import { Msg, errText } from '../components';
import { useAuth } from '../auth';
import { useListings } from '../listings';
import { supabase } from '../supabase';

export function SettingsPage() {
  const { session } = useAuth();
  const { listings } = useListings();
  const [reports, setReports] = useState<Record<string, boolean>>({});
  const [pw, setPw] = useState('');
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
      <h1>Settings</h1>
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
      <button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </>
  );
}

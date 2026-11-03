import { useEffect, useState, type FormEvent } from 'react';

import { AuthLayout } from './auth-layout';
import { Msg } from './components';
import { useAuth } from './auth';
import { supabase } from './supabase';

// Two-step sign in for every portal account (admins and businesses), with an
// authenticator app (Google Authenticator, Microsoft Authenticator, 1Password
// and similar). The database insists on it too (sql/109).

export type MfaNeed = 'none' | 'verify' | 'enroll';

export async function checkMfaNeed(): Promise<MfaNeed> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return 'none';
  if (data.currentLevel === 'aal2') return 'none';
  // The emergency switch in sql/109. If it can't be read, ask for the code anyway.
  const { data: required, error: reqErr } = await supabase.rpc('portal_mfa_required');
  if (!reqErr && required === false) return 'none';
  return data.nextLevel === 'aal2' ? 'verify' : 'enroll';
}

export function MfaGate() {
  const { mfa, refreshMfa, signOut, session } = useAuth();
  const [factorId, setFactorId] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let gone = false;
    (async () => {
      setErr('');
      const { data: list, error } = await supabase.auth.mfa.listFactors();
      if (error) return !gone && setErr(error.message);
      const totp = list?.all?.filter((f) => f.factor_type === 'totp') ?? [];
      if (mfa === 'verify') {
        const f = totp.find((x) => x.status === 'verified');
        if (f && !gone) setFactorId(f.id);
        return;
      }
      // Set up: clear any half-finished set up first, then start a new one.
      for (const f of totp.filter((x) => x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `WhileIn Portal ${new Date().toISOString().slice(0, 16)}`,
        issuer: 'WhileIn Portal',
      });
      if (gone) return;
      if (enrollErr || !data) return setErr(enrollErr?.message ?? 'Could not start the set up. Reload the page.');
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    })();
    return () => { gone = true; };
  }, [mfa]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const c = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(c)) return setErr('Enter the 6-digit code from your authenticator app.');
    if (!factorId) return setErr('Still loading. Try again in a moment.');
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: c });
    setBusy(false);
    if (error) {
      setCode('');
      return setErr(/invalid|expired/i.test(error.message) ? 'That code did not work. Codes change every 30 seconds, so use the newest one.' : error.message);
    }
    await refreshMfa();
  }

  return (
    <AuthLayout>
      <div className="card">
        <h1>{mfa === 'enroll' ? 'Set up two-step sign in' : 'Enter your code'}</h1>
        {mfa === 'enroll' ? (
          <>
            <p className="muted">
              WhileIn Business accounts control listings and billing, so they need a code from an authenticator app
              (Google Authenticator, Microsoft Authenticator, 1Password or similar) as well as the password.
            </p>
            <ol className="small" style={{ paddingLeft: 18 }}>
              <li>Open your authenticator app and add an account by scanning this code.</li>
              <li>Type the 6-digit code it shows below.</li>
            </ol>
            {qr ? (
              <div style={{ textAlign: 'center', margin: '12px 0' }}>
                <img src={qr} alt="QR code for your authenticator app" width={180} height={180} style={{ background: '#fff', padding: 8, borderRadius: 12 }} />
                <p className="small muted" style={{ wordBreak: 'break-all' }}>Can't scan? Enter this key instead: <strong>{secret}</strong></p>
              </div>
            ) : (
              <p className="muted small">Preparing your code…</p>
            )}
          </>
        ) : (
          <p className="muted">Open your authenticator app and type the 6-digit code for WhileIn Portal ({session?.user.email}).</p>
        )}
        <form onSubmit={submit}>
          <label htmlFor="mfa-code">6-digit code</label>
          <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code}
            onChange={(e) => setCode(e.target.value)} autoFocus />
          {err && <Msg kind="err">{err}</Msg>}
          <button type="submit" disabled={busy} style={{ width: '100%', marginTop: 12 }}>{busy ? 'Checking…' : mfa === 'enroll' ? 'Turn on and continue' : 'Continue'}</button>
        </form>
        <p className="small muted" style={{ marginTop: 14 }}>
          Lost the phone with your authenticator? Email <a href="mailto:hello@whilein.app">hello@whilein.app</a> and we'll reset it after checking it's you.
        </p>
        <p className="small" style={{ textAlign: 'center' }}>
          <button type="button" className="ghost" onClick={signOut}>Sign out</button>
        </p>
      </div>
    </AuthLayout>
  );
}

// Account settings: replace the authenticator (new phone).
export function MfaSettingsCard() {
  const { refreshMfa } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => setCount(data?.totp?.length ?? 0));
  }, []);

  async function replace() {
    if (!window.confirm('Set up your authenticator again on a new phone? The old one stops working right away.')) return;
    setErr('');
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all ?? []) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (error) return setErr(error.message);
    }
    await supabase.auth.refreshSession();
    await refreshMfa();
  }

  return (
    <div className="card">
      <h2>Two-step sign in</h2>
      <p className="muted small">
        {count === null ? 'Checking…' : count > 0 ? 'On. Signing in needs your password and a code from your authenticator app.' : 'Not set up yet.'}
      </p>
      {err && <Msg kind="err">{err}</Msg>}
      <button type="button" className="secondary" onClick={replace}>Move to a new phone</button>
    </div>
  );
}

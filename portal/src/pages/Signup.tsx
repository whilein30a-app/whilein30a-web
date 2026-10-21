import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { AuthLayout } from '../auth-layout';
import { Msg } from '../components';
import { supabase } from '../supabase';

export function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (password.length < 10) return setErr('Use a password with at least 10 characters.');
    if (!agree) return setErr('Please confirm you have read the Privacy Policy.');
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setDone(true);
  }

  if (done) {
    return (
      <AuthLayout>
        <div className="card">
          <h1>Check your email</h1>
          <p>We sent a confirmation link to <strong>{email}</strong>. Open it, then <Link to="/login">sign in</Link>.</p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
    <div className="card">
      <h1>Create your account</h1>
      <p className="muted">Free to start. Claim your business once you are in.</p>
      <form onSubmit={submit}>
        <label htmlFor="email">Work email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password (10 characters or more)</label>
        <input id="password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I have read the <Link to="/privacy" target="_blank">Privacy Policy</Link></span>
        </label>
        {err && <Msg kind="err">{err}</Msg>}
        <button type="submit" disabled={busy} style={{ width: '100%', marginTop: 20 }}>{busy ? 'Creating...' : 'Create account'}</button>
      </form>
      <p className="small muted" style={{ marginTop: 14, textAlign: 'center' }}>Already have an account? <Link to="/login">Sign in</Link></p>
    </div>
    </AuthLayout>
  );
}

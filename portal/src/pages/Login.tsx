import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Msg } from '../components';
import { useAuth } from '../auth';
import { supabase } from '../supabase';

export function LoginPage() {
  const { session } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const from = (loc.state as { from?: string } | null)?.from ?? '/';

  if (session) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    // The same message for a wrong password and an unknown email, so the
    // form cannot be used to find out who has an account.
    if (error) setErr(/confirm/i.test(error.message) ? 'Please confirm your email first. Check your inbox.' : 'That email and password do not match.');
    else nav(from, { replace: true });
  }

  async function reset() {
    setErr('');
    setInfo('');
    if (!email.trim()) return setErr('Enter your email above first.');
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/settings` });
    setInfo('If that email has an account, a reset link is on its way.');
  }

  return (
    <div className="center card">
      <h1>Business login</h1>
      <p className="muted">Manage your in30A listing, deals and events.</p>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <Msg kind="err">{err}</Msg>}
        {info && <Msg kind="ok">{info}</Msg>}
        <div className="row spread" style={{ marginTop: 18 }}>
          <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
          <button type="button" className="secondary" onClick={reset}>Forgot password</button>
        </div>
      </form>
      <p className="small muted" style={{ marginTop: 18 }}>New here? <Link to="/signup">Create an account</Link></p>
    </div>
  );
}

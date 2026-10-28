// Everyone with an account: app users and businesses (portal walkthrough).
import { Users as UsersIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Empty, Msg, PageHeader, errText } from '../../components';
import { supabase } from '../../supabase';

type Row = {
  id: string; email: string | null; first_name: string | null; last_name: string | null; created_at: string; last_sign_in_at: string | null;
  is_admin: boolean; phone_verified: boolean; posting_banned: boolean; listings: string | null; applications: number;
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never');

export function UsersPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_users', { p_search: search || null, p_limit: 300 });
    if (error) return setErr(errText(error));
    setErr('');
    setRows((data ?? []) as Row[]);
  }, [search]);
  useEffect(() => { load(); }, [load]);

  async function ban(r: Row, on: boolean) {
    const reason = on ? window.prompt(`Why is ${r.email} banned from posting? (saved in the audit log)`) : '';
    if (on && !reason) return;
    setBusy(r.id);
    const { error } = await supabase.rpc('admin_set_posting_ban', { p_user: r.id, p_ban: on, p_reason: reason || null });
    setBusy('');
    if (error) return setErr(errText(error));
    load();
  }

  return (
    <>
      <PageHeader title="Users" sub="App users and business accounts, newest first" />
      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); setSearch(q.trim()); }} style={{ marginBottom: 14 }}>
        <input aria-label="Search users" placeholder="Search by email, name or business" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button type="submit">Search</button>
      </form>
      {err && <Msg kind="err">{err}</Msg>}
      {rows && rows.length === 0 && <Empty icon={<UsersIcon size={22} />} title="No one found" />}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Person</th><th>Joined</th><th>Last sign in</th><th>Businesses</th><th>Flags</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{[r.first_name, r.last_name].filter(Boolean).join(' ') || 'No name'}</strong><div className="muted small">{r.email}</div></td>
                  <td className="small">{day(r.created_at)}</td>
                  <td className="small">{day(r.last_sign_in_at)}</td>
                  <td className="small">{r.listings ?? <span className="muted">None</span>}{r.applications ? <div className="muted small">{r.applications} application{r.applications === 1 ? '' : 's'}</div> : null}</td>
                  <td className="small">
                    {[r.is_admin ? 'Admin' : null, r.phone_verified ? 'Phone confirmed' : null, r.posting_banned ? 'Banned from posting' : null].filter(Boolean).join(', ') || <span className="muted">None</span>}
                  </td>
                  <td>
                    {!r.is_admin && (
                      <button type="button" className="ghost" disabled={busy === r.id} onClick={() => ban(r, !r.posting_banned)}>
                        {r.posting_banned ? 'Lift ban' : 'Ban from posting'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Shows up to 300 people. Search to narrow it down.</p>
    </>
  );
}

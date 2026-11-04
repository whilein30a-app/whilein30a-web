import { Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Empty, Msg, PageHeader, errText } from '../../components';
import { supabase } from '../../supabase';

type Report = { reason: string; note: string | null; email: string | null; at: string };
type Post = {
  id: string;
  post_type: 'lost' | 'found';
  item_description: string;
  location_name: string | null;
  contact_info: string | null;
  created_at: string;
  is_resolved: boolean;
  is_hidden: boolean;
  hidden_reason: string | null;
  user_id: string | null;
  email: string | null;
  posting_banned: boolean;
  open_reports: number;
  reports: Report[];
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Reported or hidden Lost & Found posts (sql/111). "All recent" shows live ones too. */
export function LostFoundPage() {
  const [scope, setScope] = useState<'reported' | 'all'>('reported');
  const [rows, setRows] = useState<Post[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_lost_found_queue', { p_scope: scope });
    if (error) return setErr(errText(error));
    setErr('');
    setRows((data ?? []) as Post[]);
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: 'hide' | 'restore' | 'remove' | 'dismiss') {
    if (action === 'remove' && !window.confirm('Delete this post for everyone? This cannot be undone.')) return;
    setBusy(id);
    const { error } = await supabase.rpc('admin_moderate_lost_found', { p_id: id, p_action: action });
    setBusy('');
    if (error) return setErr(errText(error));
    load();
  }

  async function ban(userId: string | null, on: boolean) {
    if (!userId) return;
    const reason = on ? window.prompt('Why is this person banned from posting? (saved in the audit log)') : '';
    if (on && !reason) return;
    setBusy(userId);
    const { error } = await supabase.rpc('admin_set_posting_ban', { p_user: userId, p_ban: on, p_reason: reason || null });
    setBusy('');
    if (error) return setErr(errText(error));
    load();
  }

  return (
    <>
      <PageHeader title="Lost & Found" sub="Reported posts. 3 reports from different people hide a post until you check it." />
      <div className="toggle" role="group" aria-label="Which posts" style={{ marginBottom: 14 }}>
        <button type="button" aria-pressed={scope === 'reported'} onClick={() => setScope('reported')}>Reported</button>
        <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All recent</button>
      </div>
      {err && <Msg kind="err">{err}</Msg>}
      {rows && rows.length === 0 && <Empty icon={<Search size={22} />} title={scope === 'reported' ? 'Nothing reported' : 'No posts yet'} />}
      {(rows ?? []).map((p) => (
        <div className="card" key={p.id}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>{p.post_type === 'lost' ? 'LOST' : 'FOUND'}: {p.item_description}</strong>
            {p.is_hidden
              ? <span className="badge">{p.hidden_reason === 'auto_hide' ? 'Hidden by reports' : 'Hidden'}</span>
              : <span className="badge approved">Live</span>}
          </div>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {[p.location_name, p.contact_info && `Contact: ${p.contact_info}`, p.email, when(p.created_at), p.is_resolved && 'Resolved']
              .filter(Boolean).join(' · ')}
          </p>
          {p.reports.length > 0 && (
            <ul className="small" style={{ margin: '10px 0 0', paddingLeft: 18 }}>
              {p.reports.map((r, i) => (
                <li key={i}>
                  <strong>{r.reason}</strong>{r.note ? `: ${r.note}` : ''} <span className="muted">({r.email ?? 'deleted account'}, {when(r.at)})</span>
                </li>
              ))}
            </ul>
          )}
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {p.is_hidden
              ? <button type="button" disabled={busy === p.id} onClick={() => act(p.id, 'restore')}>Restore</button>
              : <button type="button" className="secondary" disabled={busy === p.id} onClick={() => act(p.id, 'hide')}>Hide</button>}
            {p.open_reports > 0 && !p.is_hidden && (
              <button type="button" className="secondary" disabled={busy === p.id} onClick={() => act(p.id, 'dismiss')}>Dismiss reports</button>
            )}
            <button type="button" className="secondary" disabled={busy === p.id} onClick={() => act(p.id, 'remove')}>Delete</button>
            {p.user_id && (
              <button type="button" className="ghost" disabled={busy === p.user_id} onClick={() => ban(p.user_id, !p.posting_banned)}>
                {p.posting_banned ? 'Lift posting ban' : 'Ban this person from posting'}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

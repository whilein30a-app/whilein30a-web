import { Image } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Empty, Msg, PageHeader, errText } from '../../components';
import { supabase } from '../../supabase';

type Post = { id: string; photo_url: string; caption: string | null; location_name: string | null; created_at: string; is_hidden: boolean; email: string | null };

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** New Photo Wall posts stay hidden until approved here. "All" shows live ones too, to remove any. */
export function PhotoWallPage() {
  const [scope, setScope] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<Post[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_photo_queue', { p_scope: scope });
    if (error) return setErr(errText(error));
    setErr('');
    setRows((data ?? []) as Post[]);
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, approve: boolean) {
    setBusy(id);
    const { error } = await supabase.rpc('admin_review_photo', { p_id: id, p_approve: approve });
    setBusy('');
    if (error) return setErr(errText(error));
    load();
  }

  return (
    <>
      <PageHeader title="Photo Wall" sub="Approve new photos before visitors see them" />
      <div className="toggle" role="group" aria-label="Which photos" style={{ marginBottom: 14 }}>
        <button type="button" aria-pressed={scope === 'pending'} onClick={() => setScope('pending')}>Waiting for review</button>
        <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All recent</button>
      </div>
      {err && <Msg kind="err">{err}</Msg>}
      {rows && rows.length === 0 && <Empty icon={<Image size={22} />} title={scope === 'pending' ? 'Nothing waiting' : 'No photos yet'} />}
      <div className="grid">
        {(rows ?? []).map((p) => (
          <div className="card" key={p.id} style={{ marginBottom: 0 }}>
            <img src={p.photo_url} alt={p.caption ?? 'Photo Wall post'} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 10 }} />
            <p className="small" style={{ margin: '8px 0 2px' }}>{p.caption ?? <span className="muted">No caption</span>}</p>
            <p className="muted small" style={{ margin: 0 }}>{[p.location_name, p.email, when(p.created_at)].filter(Boolean).join(' · ')}</p>
            <div className="row" style={{ marginTop: 10 }}>
              {p.is_hidden
                ? <button type="button" disabled={busy === p.id} onClick={() => act(p.id, true)}>Approve</button>
                : <span className="badge approved">Live</span>}
              <button type="button" className="secondary" disabled={busy === p.id} onClick={() => act(p.id, false)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

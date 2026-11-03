// The owner's reviews (Kevin's review card, Nov 3, 2026). A verified owner can
// post one public reply per review, edit it or delete it. Businesses cannot
// hide, delete or reorder reviews; that is in the Review Policy.
import { Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Empty, Msg, NeedListing, PageHeader, Skeleton, errText } from '../components';
import { reviewPolicyUrl, REVIEW_POLICY_FALLBACK } from '../reviews';
import { supabase } from '../supabase';

type Row = {
  id: string; rating: number; comment: string | null; created_at: string; edited: boolean;
  reply: string | null; reply_updated_at: string | null; reply_edited: boolean | null;
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

function ReplyBox({ r, onDone }: { r: Row; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(r.reply ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setErr('');
    const t = text.trim();
    if (t.length < 2) return setErr('Write a reply first.');
    setBusy(true);
    const { error } = await supabase.rpc('portal_reply_to_review', { p_review_id: r.id, p_body: t });
    setBusy(false);
    if (error) return setErr(errText(error));
    setOpen(false);
    onDone();
  }

  async function remove() {
    if (!window.confirm('Delete your reply? The review stays up.')) return;
    setBusy(true);
    const { error } = await supabase.rpc('portal_delete_reply', { p_review_id: r.id });
    setBusy(false);
    if (error) return setErr(errText(error));
    setText('');
    onDone();
  }

  if (!open) {
    return (
      <>
        {r.reply && (
          <div style={{ borderLeft: '3px solid var(--teal-bright)', paddingLeft: 10, marginTop: 10 }}>
            <div className="small" style={{ color: 'var(--teal)', fontWeight: 600 }}>
              Response from the owner{r.reply_edited ? ' · Edited' : ''}
            </div>
            <p style={{ margin: '4px 0 0' }}>{r.reply}</p>
          </div>
        )}
        <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="secondary" onClick={() => setOpen(true)}>{r.reply ? 'Edit reply' : 'Reply'}</button>
          {r.reply && <button type="button" className="ghost" disabled={busy} onClick={remove}>Delete reply</button>}
        </div>
        {err && <Msg kind="err">{err}</Msg>}
      </>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      <label htmlFor={`reply${r.id}`}>Your public reply (shown under the review as "Response from the owner")</label>
      <textarea id={`reply${r.id}`} rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="muted small" style={{ margin: '4px 0 0' }}>{text.trim().length} / 1000. Thank the reviewer, answer the point, keep personal details out.</p>
      {err && <Msg kind="err">{err}</Msg>}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Post reply'}</button>
        <button type="button" className="ghost" onClick={() => { setOpen(false); setText(r.reply ?? ''); setErr(''); }}>Cancel</button>
      </div>
    </div>
  );
}

function OwnerReviews({ id }: { id: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [policy, setPolicy] = useState(REVIEW_POLICY_FALLBACK);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('portal_listing_reviews', { p_listing_id: id });
    if (error) return setErr(errText(error));
    setErr('');
    setRows((data ?? []) as Row[]);
  }, [id]);
  useEffect(() => { setRows(null); load(); }, [load]);
  useEffect(() => { reviewPolicyUrl().then(setPolicy); }, []);

  return (
    <>
      <p className="muted small">
        You can reply once to each review, and edit or delete your reply. Reviews can't be hidden, deleted or reordered by a
        business, and your plan never affects reviews or ratings. If a review breaks the rules, use Report in the app.{' '}
        <a href={policy} target="_blank" rel="noopener noreferrer">Review Policy</a>
      </p>
      {err && <Msg kind="err">{err}</Msg>}
      {!rows && !err && <Skeleton height={110} count={2} />}
      {rows && rows.length === 0 && (
        <Empty icon={<Star size={22} />} title="No reviews yet">
          Print your rating QR code (Listing page) so customers can rate you in a few seconds.
        </Empty>
      )}
      {(rows ?? []).map((r) => (
        <div className="card" key={r.id}>
          <div style={{ color: '#C88A1E', fontSize: '1.1rem' }} aria-label={`${r.rating} stars`}>{stars(r.rating)}</div>
          <p className="muted small" style={{ margin: '2px 0 6px' }}>{day(r.created_at)}{r.edited ? ' · Edited' : ''}</p>
          {r.comment ? <p style={{ margin: 0 }}>{r.comment}</p> : <p className="muted small" style={{ margin: 0 }}>Stars only, no comment</p>}
          <ReplyBox r={r} onDone={load} />
        </div>
      ))}
    </>
  );
}

export function OwnerReviewsPage() {
  return (
    <>
      <PageHeader title="Reviews" sub="What visitors said, newest first, and your replies" />
      <NeedListing>{(id) => <OwnerReviews id={id} />}</NeedListing>
    </>
  );
}

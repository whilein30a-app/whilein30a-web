import { Download, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Empty, Msg, PageHeader, Skeleton, errText } from '../../components';
import { supabase } from '../../supabase';

type Row = {
  id: string; question: string; asked_at: string; answered: boolean; weak: boolean; tool: string | null;
  results: number; rating: number | null; reviewed: boolean; admin_note: string | null;
};
type Summary = { days: number; total: number; answered: number; unanswered: number; weak: number; up: number; down: number; to_review: number };

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'todo', label: 'To review' },
  { id: 'unanswered', label: 'Unanswered' },
  { id: 'weak', label: 'Weak match' },
  { id: 'down', label: 'Thumbs down' },
  { id: 'all', label: 'All' },
];
const PAGE = 50;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function AskLogPage() {
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState('todo');
  const [sum, setSum] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [more, setMore] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async (offset: number) => {
    const { data, error } = await supabase.rpc('admin_ask30a_log', { p_filter: filter, p_limit: PAGE, p_offset: offset });
    if (error) { setErr(errText(error)); return; }
    setErr('');
    const got = (data ?? []) as Row[];
    setMore(got.length === PAGE);
    setRows((prev) => (offset === 0 || !prev ? got : [...prev, ...got]));
  }, [filter]);

  useEffect(() => {
    setRows(null);
    load(0);
  }, [load]);

  useEffect(() => {
    supabase.rpc('admin_ask30a_summary', { p_days: days }).then(({ data, error }) => {
      if (error) setErr(errText(error));
      else setSum(data as Summary);
    });
  }, [days, rows]);

  async function mark(r: Row, reviewed: boolean) {
    setBusy(r.id);
    const { error } = await supabase.rpc('admin_ask30a_mark', { p_id: r.id, p_reviewed: reviewed, p_note: notes[r.id] ?? r.admin_note ?? null });
    setBusy('');
    if (error) return setErr(errText(error));
    setRows((prev) => (prev ?? []).filter((x) => x.id !== r.id || filter === 'all').map((x) => (x.id === r.id ? { ...x, reviewed, admin_note: notes[r.id] ?? x.admin_note } : x)));
  }

  function download() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['asked_at', 'question', 'answered', 'weak', 'rating', 'tool', 'results', 'reviewed', 'note'];
    const lines = (rows ?? []).map((r) => [r.asked_at, r.question, r.answered, r.weak, r.rating ?? '', r.tool ?? '', r.results, r.reviewed, r.admin_note ?? ''].map(esc).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ask30a-questions-${filter}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <PageHeader
        title="Ask WhileIn questions"
        sub="What people ask, and where the answers are weak. No names or accounts are stored."
        actions={
          <div className="toggle" role="group" aria-label="Period">
            {[7, 30, 90].map((n) => (<button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>))}
          </div>
        }
      />
      {err && <Msg kind="err">{err}</Msg>}

      {sum && (
        <div className="grid">
          <div className="tile"><div className="n">{sum.total}</div><div className="l">Questions</div></div>
          <div className="tile"><div className="n">{sum.unanswered}</div><div className="l">Unanswered</div></div>
          <div className="tile"><div className="n">{sum.weak}</div><div className="l">Weak match</div></div>
          <div className="tile"><div className="n">{sum.up} / {sum.down}</div><div className="l">Thumbs up / down</div></div>
          <div className="tile"><div className="n">{sum.to_review}</div><div className="l">Still to review</div></div>
        </div>
      )}

      <div className="toggle" role="group" aria-label="Filter" style={{ margin: '18px 0 12px', flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (<button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>))}
      </div>

      {!rows && !err && <Skeleton height={90} count={3} />}
      {rows && rows.length === 0 && (
        <Empty icon={<ThumbsUp size={26} />} title="Nothing here">
          {filter === 'todo' ? 'Every weak or unanswered question has been reviewed.' : 'No questions match this filter yet. They appear as people use Ask WhileIn.'}
        </Empty>
      )}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button type="button" className="secondary" onClick={download}><Download size={16} /> Download CSV</button>
          </div>
          <table>
            <thead><tr><th>Question</th><th>Result</th><th>Note</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ minWidth: 220 }}>
                    {r.question}
                    <div className="muted small">{when(r.asked_at)} Central</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {!r.answered && <span className="badge rejected">Unanswered</span>}{' '}
                    {r.answered && r.weak && <span className="badge pending">Weak match</span>}{' '}
                    {r.answered && !r.weak && <span className="badge approved">Answered</span>}{' '}
                    {r.rating === 1 && <ThumbsUp size={16} aria-label="Thumbs up" />}
                    {r.rating === -1 && <ThumbsDown size={16} aria-label="Thumbs down" />}
                  </td>
                  <td style={{ minWidth: 180 }}>
                    <input
                      aria-label="Note"
                      placeholder="Note, e.g. added to a rule card"
                      value={notes[r.id] ?? r.admin_note ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button type="button" disabled={busy === r.id} onClick={() => mark(r, !r.reviewed)}>
                      {r.reviewed ? 'Reopen' : 'Mark reviewed'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {more && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => load(rows.length)}>Show more</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

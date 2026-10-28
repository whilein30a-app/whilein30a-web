// Admin view of one business: details, owners, history (portal walkthrough).
import { Store } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useBillingStatus } from '../../billing';
import { Empty, Msg, PageHeader, errText } from '../../components';
import { PLAN_NAME, type PlanId } from '../../plans';
import { supabase } from '../../supabase';

type Detail = {
  listing: Record<string, any>;
  owners: Array<{ user_id: string; email: string | null; since: string }>;
  applications: Array<{ id: string; status: string; email: string | null; created_at: string; verify_method: string | null; review_note: string | null }>;
  deals: Array<{ title: string; status: string; active: boolean; valid_until: string | null }>;
  events: Array<{ title: string; status: string; start_date: string }>;
  changes: Array<{ fields: Record<string, string>; status: string; created_at: string }>;
  photos: number;
  reviews: { avg: number | null; count: number };
  audit: Array<{ action: string; at: string; by: string | null; detail: Record<string, unknown> | null }>;
};
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** /admin/business: find a business by name. */
export function BusinessSearchPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Array<{ id: string; name: string; category: string | null; plan: string | null; address: string | null }> | null>(null);
  async function find(e: FormEvent) {
    e.preventDefault();
    const term = q.trim().replace(/[%_,()]/g, ' ');
    if (term.length < 2) return;
    const { data } = await supabase.from('listings').select('id,name,category,plan,address')
      .or(`name.ilike.%${term}%,aka.ilike.%${term}%`).is('merged_into', null).order('name').limit(50);
    setRows((data ?? []) as typeof rows);
  }
  return (
    <>
      <PageHeader title="Businesses" sub="Open any listing to see its owners, history and requests" />
      <form className="row" onSubmit={find} style={{ marginBottom: 14 }}>
        <input aria-label="Business name" placeholder="Business name" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button type="submit">Find</button>
      </form>
      {rows && rows.length === 0 && <Empty icon={<Store size={22} />} title="No match" />}
      {(rows ?? []).map((r) => (
        <div className="card" key={r.id}>
          <Link to={`/admin/business/${r.id}`}><strong>{r.name}</strong></Link>
          <div className="muted small">{[r.category, PLAN_NAME[(r.plan ?? 'basic') as PlanId], r.address].filter(Boolean).join(' · ')}</div>
        </div>
      ))}
    </>
  );
}

/** /admin/business/:id */
export function BusinessDetailPage() {
  const { id = '' } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const { status: bill } = useBillingStatus(id);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_business_detail', { p_listing_id: id });
    if (error) return setErr(errText(error));
    setD(data as Detail);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function removeOwner(userId: string, email: string | null) {
    const reason = window.prompt(`Remove ${email ?? 'this person'} as an owner? They lose access to this business. Reason (saved in the log):`);
    if (!reason) return;
    setErr(''); setOk('');
    const { error } = await supabase.rpc('admin_remove_owner', { p_listing_id: id, p_user_id: userId, p_reason: reason });
    if (error) return setErr(errText(error));
    setOk('Owner removed.');
    load();
  }

  if (err && !d) return (<><PageHeader title="Business" /><Msg kind="err">{err}</Msg></>);
  if (!d) return <PageHeader title="Business" sub="Loading..." />;
  const l = d.listing;
  return (
    <>
      <PageHeader title={String(l.name)} sub={[l.subcategory ?? l.category, PLAN_NAME[(l.plan ?? 'basic') as PlanId], l.is_founding ? 'Founding Partner' : null].filter(Boolean).join(' · ')} />
      {err && <Msg kind="err">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}
      <div className="grid two">
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ marginTop: 0 }}>Details</h2>
          <table><tbody>
            {[
              ['Address', l.address], ['Phone', l.phone], ['Website', l.website], ['Area', [l.area_status, l.area_label].filter(Boolean).join(', ')],
              ['Map pin', l.latitude != null ? `${l.latitude}, ${l.longitude}` : 'None'], ['Plan paid through', l.plan_expires_on],
              ['Google place ID', l.google_place_id], ['Status', l.business_status], ['Photos', String(d.photos)],
              ['Reviews', d.reviews.count ? `${d.reviews.avg} from ${d.reviews.count}` : 'None'], ['Also known as', l.aka],
              ['Stripe billing', bill?.subscription ? `${bill.subscription.plan}, ${bill.subscription.billing}ly, ${bill.subscription.status}${bill.subscription.cancel_at_period_end ? `, ends ${bill.subscription.renews_on}` : `, renews ${bill.subscription.renews_on}`}` : bill?.has_customer ? 'Customer, no active plan' : null],
              ['Pin from', l.coords_source], ['From Google', (l.google_fields ?? []).join(', ') || null],
            ].map(([k, v]) => (<tr key={k as string}><td className="muted small">{k}</td><td className="small">{v ? String(v) : <span className="muted">None</span>}</td></tr>))}
          </tbody></table>
          <p className="small" style={{ marginBottom: 0 }}><Link to="/admin/plans">Change plan, subcategory or pin in Plans and slots</Link></p>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ marginTop: 0 }}>Owners</h2>
          {d.owners.length === 0 && <p className="muted small">Unclaimed. Nobody manages it.</p>}
          {d.owners.map((o) => (
            <div key={o.user_id} className="row spread" style={{ minHeight: 44 }}>
              <span className="small">{o.email ?? o.user_id}<div className="muted small">since {when(o.since)}</div></span>
              <button type="button" className="ghost" onClick={() => removeOwner(o.user_id, o.email)}>Remove</button>
            </div>
          ))}
          <h3>Claims</h3>
          {d.applications.length === 0 && <p className="muted small">None.</p>}
          {d.applications.map((a) => (
            <p key={a.id} className="small" style={{ margin: '4px 0' }}>
              <span className={`badge ${a.status}`}>{a.status}</span> {a.email} · {when(a.created_at)}{a.verify_method ? ` · verified by ${a.verify_method === 'phone_code' ? 'phone code' : 'email domain'}` : ''}{a.review_note ? ` · ${a.review_note}` : ''}
            </p>
          ))}
        </div>
      </div>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ marginTop: 0 }}>Deals and events</h2>
          {d.deals.length + d.events.length === 0 && <p className="muted small">None.</p>}
          {d.deals.map((x, i) => (<p key={'d' + i} className="small" style={{ margin: '4px 0' }}>Deal: {x.title} · {x.status}{x.active ? ', live' : ''}{x.valid_until ? ` · until ${x.valid_until}` : ''}</p>))}
          {d.events.map((x, i) => (<p key={'e' + i} className="small" style={{ margin: '4px 0' }}>Event: {x.title} · {x.start_date} · {x.status}</p>))}
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <h2 style={{ marginTop: 0 }}>Change requests</h2>
          {d.changes.length === 0 && <p className="muted small">None.</p>}
          {d.changes.map((c, i) => (<p key={i} className="small" style={{ margin: '4px 0' }}>{Object.entries(c.fields).map(([k, v]) => `${k}: ${v}`).join(' · ')} · {c.status} · {when(c.created_at)}</p>))}
          <p className="small"><Link to="/admin/changes">All change requests</Link></p>
        </div>
      </div>

      <h2>History</h2>
      <div className="card">
        {d.audit.length === 0 && <p className="muted small">Nothing logged yet.</p>}
        {d.audit.map((a, i) => (
          <p key={i} className="small" style={{ margin: '4px 0' }}>{when(a.at)} · {a.action.replace(/_/g, ' ')}{a.by ? ` · ${a.by}` : ''}</p>
        ))}
      </div>
    </>
  );
}

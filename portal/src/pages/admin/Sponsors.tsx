import { useCallback, useEffect, useState, type ChangeEvent } from 'react';

import { Msg, errText, PageHeader } from '../../components';
import { supabase } from '../../supabase';

type Slot = 'home_carousel' | 'section_parking' | 'section_beaches' | 'section_weather' | 'section_events' | 'section_tram' | 'presenting';
type Spot = {
  id: string; slot: Slot; sponsor_name: string; headline: string | null; image_url: string | null; logo_url: string | null;
  link_url: string | null; sort_order: number; is_active: boolean; starts_on: string | null; ends_on: string | null;
};

const SLOTS: Array<{ id: Slot; label: string; cap: number; hint: string }> = [
  { id: 'presenting', label: 'Presenting sponsor ("WhileIn presented by")', cap: 1, hint: 'One for the whole app. Logo works best.' },
  { id: 'home_carousel', label: 'Home carousel', cap: 5, hint: 'Up to 5 rotating slides. Use a wide image (about 1200 x 500).' },
  { id: 'section_parking', label: 'Parking banner', cap: 1, hint: 'Logo and link.' },
  { id: 'section_beaches', label: 'Beaches & Accesses banner', cap: 1, hint: 'Logo and link.' },
  { id: 'section_weather', label: 'Weather & Tides banner', cap: 1, hint: 'Logo and link.' },
  { id: 'section_events', label: 'Events banner', cap: 1, hint: 'Logo and link.' },
  { id: 'section_tram', label: 'Tram banner', cap: 1, hint: 'Logo and link.' },
];

const MAX = 2 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function Editor({ slot, spot, onDone, onCancel }: { slot: Slot; spot: Spot | null; onDone: (m: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(spot?.sponsor_name ?? '');
  const [headline, setHeadline] = useState(spot?.headline ?? '');
  const [link, setLink] = useState(spot?.link_url ?? '');
  const [image, setImage] = useState(spot?.image_url ?? '');
  const [logo, setLogo] = useState(spot?.logo_url ?? '');
  const [order, setOrder] = useState(spot?.sort_order ?? 0);
  const [active, setActive] = useState(spot?.is_active ?? true);
  const [starts, setStarts] = useState(spot?.starts_on ?? '');
  const [ends, setEnds] = useState(spot?.ends_on ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function upload(e: ChangeEvent<HTMLInputElement>, set: (u: string) => void) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErr('');
    const ext = EXT[f.type];
    if (!ext) return setErr('Use a PNG, JPG or WebP image.');
    if (f.size > MAX) return setErr('The image must be under 2 MB.');
    setBusy(true);
    const path = `${slot}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('sponsor-assets').upload(path, f, { contentType: f.type });
    setBusy(false);
    if (error) return setErr(errText(error));
    set(supabase.storage.from('sponsor-assets').getPublicUrl(path).data.publicUrl);
  }

  async function save() {
    setErr('');
    if (link && !/^https:\/\/[^\s]+$/i.test(link)) return setErr('The link must start with https://');
    setBusy(true);
    const row = {
      slot, sponsor_name: name.trim(), headline: headline.trim() || null, link_url: link.trim() || null,
      image_url: image || null, logo_url: logo || null, sort_order: order, is_active: active,
      starts_on: starts || null, ends_on: ends || null,
    };
    const { error } = spot
      ? await supabase.from('sponsor_spots').update(row).eq('id', spot.id)
      : await supabase.from('sponsor_spots').insert(row);
    setBusy(false);
    if (error) return setErr(errText(error));
    onDone(spot ? 'Sponsor updated.' : 'Sponsor added.');
  }

  return (
    <div className="card">
      <label htmlFor="sn">Sponsor name</label>
      <input id="sn" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="sh">Headline (optional)</label>
      <input id="sh" maxLength={120} value={headline} onChange={(e) => setHeadline(e.target.value)} />
      <label htmlFor="sl">Link (https)</label>
      <input id="sl" type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
      <label htmlFor="si">Image (slide)</label>
      {image && <div className="row" style={{ marginBottom: 6 }}><img src={image} alt="" style={{ height: 60, borderRadius: 8 }} /><button type="button" className="secondary" onClick={() => setImage('')}>Remove</button></div>}
      <input id="si" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e, setImage)} disabled={busy} />
      <label htmlFor="sg">Logo</label>
      {logo && <div className="row" style={{ marginBottom: 6 }}><img src={logo} alt="" style={{ height: 48, borderRadius: 8 }} /><button type="button" className="secondary" onClick={() => setLogo('')}>Remove</button></div>}
      <input id="sg" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(e, setLogo)} disabled={busy} />
      <div className="grid">
        <div><label htmlFor="so">Order</label><input id="so" type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} /></div>
        <div><label htmlFor="ss">Starts</label><input id="ss" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
        <div><label htmlFor="se">Ends</label><input id="se" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Showing in the app</span></label>
      {err && <Msg kind="err">{err}</Msg>}
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" disabled={busy || name.trim().length < 2} onClick={save}>{busy ? 'Working...' : 'Save'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function SponsorsPage() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [editing, setEditing] = useState<{ slot: Slot; spot: Spot | null } | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('sponsor_spots').select('*').order('slot').order('sort_order');
    if (error) setErr(errText(error));
    setSpots((data ?? []) as Spot[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggle(s: Spot) {
    setErr(''); setMsg('');
    const { error } = await supabase.from('sponsor_spots').update({ is_active: !s.is_active }).eq('id', s.id);
    if (error) setErr(errText(error));
    load();
  }

  async function remove(s: Spot) {
    if (!window.confirm(`Delete ${s.sponsor_name}?`)) return;
    setErr(''); setMsg('');
    const { error } = await supabase.from('sponsor_spots').delete().eq('id', s.id);
    if (error) setErr(errText(error)); else setMsg('Deleted.');
    load();
  }

  return (
    <>
      <PageHeader title="Sponsors" sub="Home carousel, section banners and the presenting sponsor" />
      <p className="muted">Sold by you and turned on here. Changes show in the app within a few minutes.</p>
      {msg && <Msg kind="ok">{msg}</Msg>}
      {err && <Msg kind="err">{err}</Msg>}
      {SLOTS.map((sl) => {
        const mine = spots.filter((s) => s.slot === sl.id);
        const activeCount = mine.filter((s) => s.is_active).length;
        return (
          <div key={sl.id}>
            <div className="row spread">
              <h2>{sl.label}</h2>
              <span className="muted small">{activeCount} of {sl.cap} showing</span>
            </div>
            <p className="muted small" style={{ marginTop: -4 }}>{sl.hint}</p>
            {mine.length === 0 && <p className="muted">Empty.</p>}
            {mine.map((s) => (
              editing?.spot?.id === s.id ? (
                <Editor key={s.id} slot={sl.id} spot={s} onCancel={() => setEditing(null)} onDone={(m) => { setEditing(null); setMsg(m); setErr(''); load(); }} />
              ) : (
                <div className="card" key={s.id}>
                  <div className="row spread">
                    <div className="row">
                      {(s.logo_url || s.image_url) && <img src={(s.logo_url || s.image_url) as string} alt="" style={{ height: 44, borderRadius: 8 }} />}
                      <div><strong>{s.sponsor_name}</strong><div className="muted small">{s.headline}</div></div>
                    </div>
                    <span className={`badge ${s.is_active ? 'approved' : ''}`}>{s.is_active ? 'Showing' : 'Off'}</span>
                  </div>
                  <p className="muted small">{s.link_url ?? 'No link'}{s.starts_on ? ` · from ${s.starts_on}` : ''}{s.ends_on ? ` · until ${s.ends_on}` : ''}</p>
                  <div className="row">
                    <button type="button" className="secondary" onClick={() => setEditing({ slot: sl.id, spot: s })}>Edit</button>
                    <button type="button" className="secondary" onClick={() => toggle(s)}>{s.is_active ? 'Turn off' : 'Turn on'}</button>
                    <button type="button" className="secondary" onClick={() => remove(s)}>Delete</button>
                  </div>
                </div>
              )
            ))}
            {editing && !editing.spot && editing.slot === sl.id ? (
              <Editor slot={sl.id} spot={null} onCancel={() => setEditing(null)} onDone={(m) => { setEditing(null); setMsg(m); setErr(''); load(); }} />
            ) : (
              <button type="button" className="secondary" onClick={() => setEditing({ slot: sl.id, spot: null })}>Add a sponsor</button>
            )}
          </div>
        );
      })}
    </>
  );
}

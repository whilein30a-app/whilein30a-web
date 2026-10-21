import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { NeedListing, Msg, errText, PageHeader } from '../components';
import { useListings } from '../listings';
import { PLAN_NAME } from '../plans';
import { supabase } from '../supabase';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function Form({ id }: { id: string }) {
  const { current, reload } = useListings();
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [menuUrl, setMenuUrl] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setDescription(current?.description ?? '');
    setPhone(current?.phone ?? '');
    setWebsite(current?.website ?? '');
    setMenuUrl(current?.menu_url ?? '');
    setBookingUrl(current?.booking_url ?? '');
    setLogoUrl(current?.logo_url ?? '');
  }, [current]);

  async function uploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setOk(false);
    const ext = TYPES[file.type];
    if (!ext) return setErr('Use a PNG, JPG or WebP image.');
    if (file.size > MAX_BYTES) return setErr('The image must be under 2 MB.');
    setUploading(true);
    const path = `${id}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('listing-assets').upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      setUploading(false);
      return setErr(errText(error));
    }
    const url = supabase.storage.from('listing-assets').getPublicUrl(path).data.publicUrl;
    setLogoUrl(url);
    setUploading(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setOk(false);
    setBusy(true);
    // Only send what changed, so a Basic listing can still edit its phone
    // when plan limits are on.
    const next: Record<string, string> = { description, phone, website, menu_url: menuUrl, booking_url: bookingUrl, logo_url: logoUrl };
    const was: Record<string, string> = {
      description: current?.description ?? '', phone: current?.phone ?? '', website: current?.website ?? '',
      menu_url: current?.menu_url ?? '', booking_url: current?.booking_url ?? '', logo_url: current?.logo_url ?? '',
    };
    const fields: Record<string, string> = {};
    for (const k of Object.keys(next)) if (next[k] !== was[k]) fields[k] = next[k];
    if (Object.keys(fields).length === 0) {
      setBusy(false);
      return setOk(true);
    }
    const { error } = await supabase.rpc('portal_update_listing', { p_listing_id: id, p_fields: fields });
    setBusy(false);
    if (error) return setErr(errText(error));
    setOk(true);
    reload();
  }

  const plan = current?.plan ?? 'basic';

  return (
    <form className="card" onSubmit={save}>
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{current?.name}</h2>
        <span className="badge approved">{PLAN_NAME[plan]}</span>
      </div>
      <p className="muted small">
        {current?.address}{current?.category ? ` · ${current.category}` : ''}{current?.subcategory ? ` · ${current.subcategory}` : ''}.
        To change the name, address, category or subcategory, email hello@in30a.app.
      </p>
      {plan === 'basic' && (
        <Msg kind="ok">Your plan is Basic. Logo, description, menu and booking links, a photo gallery, deals and events are part of Premium and above. <Link to="/plan">See plans</Link></Msg>
      )}
      <label htmlFor="d">Description</label>
      <textarea id="d" maxLength={1500} value={description} onChange={(e) => setDescription(e.target.value)} />
      <label htmlFor="p">Phone</label>
      <input id="p" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label htmlFor="w">Website</label>
      <input id="w" type="url" placeholder="https://" maxLength={300} value={website} onChange={(e) => setWebsite(e.target.value)} />
      <label htmlFor="m">Menu link</label>
      <input id="m" type="url" placeholder="https://" maxLength={300} value={menuUrl} onChange={(e) => setMenuUrl(e.target.value)} />
      <label htmlFor="b">Booking link</label>
      <input id="b" type="url" placeholder="https://" maxLength={300} value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} />

      <label htmlFor="lg">Logo</label>
      {logoUrl && (
        <div className="row" style={{ marginBottom: 8 }}>
          <img src={logoUrl} alt="Your logo" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--line)' }} />
          <button type="button" className="secondary" onClick={() => setLogoUrl('')}>Remove logo</button>
        </div>
      )}
      <input id="lg" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} disabled={uploading} />
      <p className="muted small">PNG, JPG or WebP, under 2 MB. Save changes to apply it.</p>

      {err && <Msg kind="err">{err}</Msg>}
      {ok && <Msg kind="ok">Saved. The app shows the new details right away.</Msg>}
      <div style={{ marginTop: 18 }}><button type="submit" disabled={busy || uploading}>{busy ? 'Saving...' : uploading ? 'Uploading...' : 'Save changes'}</button></div>
    </form>
  );
}

export function ListingPage() {
  return (
    <>
      <PageHeader title="Your listing" sub="What visitors see when they open you in the app" />
      <NeedListing>{(id) => <Form id={id} />}</NeedListing>
    </>
  );
}

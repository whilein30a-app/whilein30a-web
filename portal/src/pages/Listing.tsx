import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { NeedListing, Msg, errText, PageHeader } from '../components';
import { useListings } from '../listings';
import { PLAN_NAME } from '../plans';
import { supabase } from '../supabase';
import { acceptBusinessTerms, BusinessTermsCheck } from '../terms';
import QRCode from 'qrcode';
import { rateUrl } from '../reviews';
import { ChangeRequests, Gallery, usePhotos, useLimited, VisitorPreview } from './listing-extras';
import { cleanImage } from '../clean-image';

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
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoTerms, setLogoTerms] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setDescription(current?.description ?? '');
    setPhone(current?.phone ?? '');
    setWebsite(current?.website ?? '');
    setMenuUrl(current?.menu_url ?? '');
    setBookingUrl(current?.booking_url ?? '');
    setLogoUrl(current?.logo_url ?? '');
    setHours(current?.hours_note ?? '');
  }, [current]);

  async function uploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setOk(false);
    const ext = TYPES[file.type];
    if (!ext) return setErr('Use a PNG, JPG or WebP image.');
    if (file.size > MAX_BYTES) return setErr('The image must be under 2 MB.');
    if (!logoTerms) return setErr('Please agree to the WhileIn Business Listing Terms before you upload.');
    setUploading(true);
    const termsErr = await acceptBusinessTerms('upload', id);
    if (termsErr) { setUploading(false); return setErr(termsErr); }
    const path = `${id}/logo-${Date.now()}.${ext}`;
    let clean: File;
    try { clean = await cleanImage(file); } catch (e) { setUploading(false); return setErr((e as Error).message); }
    const { error } = await supabase.storage.from('listing-assets').upload(path, clean, { contentType: clean.type, upsert: false });
    if (error) {
      setUploading(false);
      return setErr(errText(error));
    }
    const url = supabase.storage.from('listing-assets').getPublicUrl(path).data.publicUrl;
    setLogoUrl(url);
    setUploading(false);
    setLogoTerms(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setOk(false);
    setBusy(true);
    // Only send what changed, so a Basic listing can still edit its phone
    // when plan limits are on.
    const next: Record<string, string> = { description, phone, website, menu_url: menuUrl, booking_url: bookingUrl, logo_url: logoUrl, hours_note: hours };
    const was: Record<string, string> = {
      description: current?.description ?? '', phone: current?.phone ?? '', website: current?.website ?? '',
      menu_url: current?.menu_url ?? '', booking_url: current?.booking_url ?? '', logo_url: current?.logo_url ?? '', hours_note: current?.hours_note ?? '',
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
  const locked = plan === 'basic';

  return (
    <form className="card" onSubmit={save}>
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{current?.name}</h2>
        <span className="badge approved">{PLAN_NAME[plan]}</span>
      </div>
      <p className="muted small">
        {current?.address}{current?.category ? ` · ${current.category}` : ''}{current?.subcategory ? ` · ${current.subcategory}` : ''}.
        To change the name, address, category or subcategory, email hello@whilein.app (we also move your map pin when the address changes).
      </p>
      {plan === 'basic' && (
        <Msg kind="ok">Your plan is Basic: name, address, map pin, phone, hours and one cover photo. Description, links, logo, deals and events are part of Premium and above. <Link to="/plan">See plans</Link></Msg>
      )}
      <label htmlFor="p">Phone (visitors tap to call)</label>
      <input id="p" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label htmlFor="h">Hours</label>
      <textarea id="h" maxLength={600} placeholder={'Mon-Fri 9 AM - 5 PM\nSat 10 AM - 4 PM\nSun closed'} value={hours} onChange={(e) => setHours(e.target.value)} />
      <p className="muted small">One line per day or range. Shown on your listing in the app.</p>

      <h3 style={{ marginBottom: 4 }}>Premium and above {locked && <span className="badge">Locked</span>}</h3>
      {locked && <p className="muted small">These show in the app only on Premium and above. <Link to="/plan">Upgrade to add them</Link></p>}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, opacity: locked ? 0.55 : 1 }}>
        <label htmlFor="d">Description</label>
        <textarea id="d" maxLength={1500} value={description} onChange={(e) => setDescription(e.target.value)} />
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
        {!locked && <BusinessTermsCheck id="logo-terms" checked={logoTerms} onChange={setLogoTerms} />}
        <input id="lg" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadLogo} disabled={uploading || locked || !logoTerms} />
        <p className="muted small">Your logo shows next to your name. Square works best, at least 400 by 400 pixels. PNG, JPG or WebP, under 2 MB. Save changes to apply it.</p>
      </fieldset>

      {err && <Msg kind="err">{err}</Msg>}
      {ok && <Msg kind="ok">Saved. The app shows the new details right away.</Msg>}
      <div style={{ marginTop: 18 }}><button type="submit" disabled={busy || uploading}>{busy ? 'Saving...' : uploading ? 'Uploading...' : 'Save changes'}</button></div>
    </form>
  );
}

/** The one cover photo every plan gets. It is the first photo on the card and the listing in the app. */
function CoverPhoto({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coverTerms, setCoverTerms] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    supabase.from('listing_photos').select('url').eq('listing_id', id).order('sort_order').limit(1)
      .then(({ data }) => setUrl((data ?? [])[0]?.url ?? null));
  }, [id]);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setOk('');
    const ext = TYPES[file.type];
    if (!ext) return setErr('Use a PNG, JPG or WebP image.');
    if (file.size > 5 * 1024 * 1024) return setErr('The photo must be under 5 MB.');
    if (!coverTerms) return setErr('Please agree to the WhileIn Business Listing Terms before you upload.');
    setBusy(true);
    const termsErr = await acceptBusinessTerms('upload', id);
    if (termsErr) { setBusy(false); return setErr(termsErr); }
    const path = `${id}/cover-${Date.now()}.${ext}`;
    let clean: File;
    try { clean = await cleanImage(file); } catch (e) { setBusy(false); return setErr((e as Error).message); }
    const up = await supabase.storage.from('listing-assets').upload(path, clean, { contentType: clean.type, upsert: false });
    if (up.error) { setBusy(false); return setErr(errText(up.error)); }
    const publicUrl = supabase.storage.from('listing-assets').getPublicUrl(path).data.publicUrl;
    const { error } = await supabase.rpc('portal_set_cover_photo', { p_listing_id: id, p_url: publicUrl });
    setBusy(false);
    if (error) return setErr(errText(error));
    setUrl(publicUrl);
    setCoverTerms(false);
    onChanged?.();
    setOk('Cover photo saved. The app shows it right away.');
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Cover photo</h2>
      <p className="muted small">Every plan gets one. It is the picture on your card in lists, on the map and at the top of your listing. Use a wide photo of your place, at least 1200 by 800 pixels, JPG or PNG, under 5 MB.</p>
      {url ? <img src={url} alt="Your cover" style={{ width: '100%', maxWidth: 420, aspectRatio: '3 / 2', objectFit: 'cover', borderRadius: 12, border: '1px solid var(--line)' }} /> : <p className="muted small">No cover photo yet.</p>}
      <div style={{ marginTop: 10 }}>
        <label htmlFor="cover">{url ? 'Replace cover photo' : 'Upload a cover photo'}</label>
        <BusinessTermsCheck id="cover-terms" checked={coverTerms} onChange={setCoverTerms} />
        <input id="cover" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={busy || !coverTerms} />
      </div>
      {busy && <p className="muted small">Uploading...</p>}
      {err && <Msg kind="err">{err}</Msg>}
      {ok && <Msg kind="ok">{ok}</Msg>}
    </div>
  );
}

// A printable QR code that opens this listing's rating screen (Trello A43).
function ReviewQr({ id }: { id: string }) {
  const { current } = useListings();
  const [url, setUrl] = useState('');
  const [img, setImg] = useState('');
  useEffect(() => {
    let live = true;
    rateUrl(id).then(async (u) => {
      const data = await QRCode.toDataURL(u, { width: 600, margin: 2, color: { dark: '#0B3954', light: '#FFFFFF' } });
      if (live) { setUrl(u); setImg(data); }
    });
    return () => { live = false; };
  }, [id]);
  const file = `WhileIn-rate-${(current?.name ?? 'listing').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Get reviews from your customers</h2>
      <p className="muted small">
        Print this code for your counter, menu or receipts. Scanning it opens your page in the WhileIn app on the rating screen.
        Reviews come from visitors with a confirmed phone number, and you cannot review your own business.
      </p>
      {img ? <img src={img} alt="QR code to rate this business" style={{ width: 200, height: 200, border: '1px solid var(--line)', borderRadius: 12 }} /> : <p className="muted small">Making your code...</p>}
      {url && <p className="small" style={{ wordBreak: 'break-all' }}>{url}</p>}
      {img && (
        <div className="row">
          <a className="btn secondary" href={img} download={file}>Download PNG</a>
        </div>
      )}
    </div>
  );
}

function ListingBody({ id }: { id: string }) {
  const { photos, reload } = usePhotos(id);
  const limited = useLimited();
  return (
    <>
      <VisitorPreview id={id} photos={photos} />
      {limited ? <CoverPhoto id={id} onChanged={reload} /> : <Gallery id={id} photos={photos} reload={reload} />}
      <Form id={id} />
      <ReviewQr id={id} />
      <ChangeRequests id={id} />
    </>
  );
}

export function ListingPage() {
  return (
    <>
      <PageHeader title="Your listing" sub="What visitors see when they open you in the app" />
      <NeedListing>{(id) => <ListingBody id={id} />}</NeedListing>
    </>
  );
}

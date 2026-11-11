// A58: posts the Photo Wall sample photos from the WhileIn team account.
//
// Kevin's rules (Nov 9): Unsplash and Pexels photos only, no faces, no logos,
// posted from a WhileIn team account (not the reviewer account), license
// list kept. Every photo is re-encoded here, which drops GPS, camera data and
// everything else embedded in the file, the same as the app does on a phone.
//
// Setup, once, in an empty folder outside the repos:
//   npm init -y
//   npm install sharp@0.35.5
//   copy post-photo-samples.mjs and manifest.example.csv into that folder
//   make a "photos" folder next to them and put the downloaded photos in it
//   copy manifest.example.csv to manifest.csv and fill one row per photo
//
// Key (type it in the terminal only, never in chat or a file):
//   read -s SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
//
// Run:
//   node post-photo-samples.mjs --email=TEAM_EMAIL            check only, posts nothing
//   node post-photo-samples.mjs --email=TEAM_EMAIL --post     post them (shown right away)
//   node post-photo-samples.mjs --undo                        remove everything this script posted
//
// posted.json (written next to this file) remembers what was posted, so a
// second run skips those photos and --undo knows what to remove. Keep it.

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const URL_BASE = (process.env.SUPABASE_URL || 'https://ugeawvndcngviriaeyle.supabase.co').replace(/\/$/, '');
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const POST = process.argv.includes('--post');
const UNDO = process.argv.includes('--undo');
const EMAIL = arg('email').trim().toLowerCase();
const MANIFEST = path.join(HERE, arg('manifest') || 'manifest.csv');
const PHOTOS = path.join(HERE, arg('photos') || 'photos');
const LOG = path.join(HERE, 'posted.json');
const BUCKET = 'photo-wall';
const SOURCES = ['unsplash', 'pexels'];

if (!KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY first (see the top of this file).');
  process.exit(1);
}
const headers = { apikey: KEY, ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}) };

async function call(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res;
}

function readLog() {
  try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch { return []; }
}
function writeLog(rows) {
  fs.writeFileSync(LOG, JSON.stringify(rows, null, 2));
}

// Small CSV reader: commas, double quotes, "" inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

async function undo() {
  const log = readLog();
  if (!log.length) { console.log('Nothing to remove, posted.json is empty.'); return; }
  for (const p of log) {
    await call(`${URL_BASE}/rest/v1/photo_wall_posts?id=eq.${p.id}`, { method: 'DELETE' });
    await call(`${URL_BASE}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [p.path] }),
    });
    console.log(`removed  ${p.file}`);
  }
  writeLog([]);
  console.log(`Done. ${log.length} sample post(s) removed.`);
}

async function findUser(email) {
  for (let page = 1; page <= 20; page++) {
    const res = await call(`${URL_BASE}/auth/v1/admin/users?page=${page}&per_page=200`);
    const body = await res.json();
    const users = body.users ?? [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === email);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

async function findListing(place) {
  const q = encodeURIComponent(place.replace(/[*,()]/g, ' '));
  const res = await call(`${URL_BASE}/rest/v1/listings?select=id,name&name=ilike.${q}&limit=2`);
  const rows = await res.json();
  return rows.length === 1 ? rows[0] : null;
}

async function main() {
  if (UNDO) return undo();
  if (!EMAIL) { console.error('Add --email=the WhileIn team account email.'); process.exit(1); }
  if (!fs.existsSync(MANIFEST)) { console.error(`No manifest at ${MANIFEST}. Copy manifest.example.csv to manifest.csv and fill it.`); process.exit(1); }

  const user = await findUser(EMAIL);
  if (!user) { console.error(`No app account with ${EMAIL}. Sign up in the app with it first (first name "WhileIn").`); process.exit(1); }
  const prof = await (await call(`${URL_BASE}/rest/v1/profiles?id=eq.${user.id}&select=is_admin,first_name`)).json().catch(() => []);
  if (prof[0]?.is_admin) console.warn('Note: this account is an admin. Kevin asked for a plain team account.');
  console.log(`Team account: ${EMAIL} (first name: ${prof[0]?.first_name ?? 'not set'})`);

  const rows = parseCsv(fs.readFileSync(MANIFEST, 'utf8'));
  const log = readLog();
  const done = new Set(log.map((p) => p.file));
  const problems = [];
  const todo = [];

  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    const need = ['file', 'place', 'source', 'photographer', 'photo_page', 'license'];
    const missing = need.filter((k) => !r[k]);
    if (missing.length) { problems.push(`row ${line}: missing ${missing.join(', ')}`); continue; }
    if (!SOURCES.includes(r.source.toLowerCase())) { problems.push(`row ${line}: source must be Unsplash or Pexels (got "${r.source}")`); continue; }
    if (!/^https:\/\/(www\.)?(unsplash\.com|pexels\.com)\//i.test(r.photo_page)) { problems.push(`row ${line}: photo_page must be the unsplash.com or pexels.com page of the photo`); continue; }
    if (!/^yes$/i.test(r.checked_no_faces_or_logos || '')) { problems.push(`row ${line}: set checked_no_faces_or_logos to yes after looking at the photo`); continue; }
    const file = path.join(PHOTOS, r.file);
    if (!fs.existsSync(file)) { problems.push(`row ${line}: ${r.file} not found in ${PHOTOS}`); continue; }
    if (done.has(r.file)) { console.log(`skip     ${r.file} (already posted)`); continue; }
    todo.push({ ...r, full: file });
  }

  if (problems.length) {
    console.log('\nFix these rows first:');
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
  }
  if (!todo.length) { console.log('Nothing new to post.'); return; }

  for (const r of todo) {
    const listing = await findListing(r.place);
    const out = await sharp(r.full).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const meta = await sharp(out).metadata();
    if (meta.exif || meta.xmp || meta.iptc) throw new Error(`${r.file}: metadata still present after re-encode, stopping`);
    const where = listing ? `${listing.name} (tagged business)` : r.place;
    if (!POST) { console.log(`ready    ${r.file} -> ${where}, ${Math.round(out.length / 1024)} KB, no metadata`); continue; }

    const objectPath = `${user.id}-${Date.now()}.jpg`;
    await call(`${URL_BASE}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }, body: out,
    });
    const photoUrl = `${URL_BASE}/storage/v1/object/public/${BUCKET}/${objectPath}`;
    const ins = await call(`${URL_BASE}/rest/v1/photo_wall_posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: user.id,
        photo_url: photoUrl,
        caption: r.caption || null,
        location_name: listing ? listing.name : r.place,
        listing_id: listing ? listing.id : null,
      }),
    });
    const [post] = await ins.json();
    // New posts are held for review by a trigger. These are our own samples,
    // so show them right away.
    await call(`${URL_BASE}/rest/v1/photo_wall_posts?id=eq.${post.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_hidden: false }),
    });
    log.push({ file: r.file, id: post.id, path: objectPath, source: r.source, photographer: r.photographer, photo_page: r.photo_page, license: r.license, posted_at: new Date().toISOString() });
    writeLog(log);
    console.log(`posted   ${r.file} -> ${where}`);
  }

  console.log(POST
    ? `\nDone. ${todo.length} posted and visible. posted.json is the license list, keep it with manifest.csv.`
    : `\nCheck only. ${todo.length} ready. Run again with --post to post them.`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

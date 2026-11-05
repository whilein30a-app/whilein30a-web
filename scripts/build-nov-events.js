// Builds sql/112_november_2026_events.sql from Kevin's two November files.
//   node build-nov-events.js <daily.docx> <arts.docx> <out.sql> <review.csv>
// Rules (Kevin, Nov 5): load from Nov 5 on, keep links, follow the file.
// Arts file heading says October; every entry is treated as November.
// A weekday that does not match the date ("Tuesday, November 13") keeps the date.
const mammoth = require('mammoth');
const fs = require('fs');

const [, , DAILY, ARTS, OUT, REVIEW] = process.argv;
const YEAR = 2026;
const FROM = '2026-11-05';
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const WD = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const iso = (m, d) => `${YEAR}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dow = (s) => new Date(s + 'T12:00:00Z').getUTCDay();
const addDays = (s, n) => { const t = new Date(s + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const range = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
const review = [];

// ---------- daily file: same line parser as parse-events-calendar.js ----------
function parseEventLine(line, nextLine) {
  let url = null, w = line;
  const um = line.match(/(https?:\/\/\S+)\s*$/);
  if (um) { url = um[1].replace(/[.,)]+$/, ''); w = line.slice(0, um.index).trim(); }
  else if (nextLine && /^https?:\/\/\S+$/.test(nextLine.trim())) { url = nextLine.trim(); w = line.replace(/(Tickets|Info|RSVP|Register)\s*@?\s*$/i, '').trim(); }
  w = w.replace(/(Tickets|Info|RSVP|Register)\s*@?\s*$/i, '').trim();
  let rest = w.replace(/(\s*[-–—]\s*)+$/, '').trim();
  const tm = rest.match(/(\d{1,2}(:\d{2})?\s*(am|pm)(\s*[-–—]\s*\d{1,2}(:\d{2})?\s*(am|pm))?)/i);
  let timeText = null;
  if (tm) { timeText = tm[1]; rest = (rest.slice(0, tm.index) + ' ' + rest.slice(tm.index + tm[0].length)).trim(); }
  rest = rest.replace(/(\s*[-–—]\s*)+$/, '').replace(/^(\s*[-–—]\s*)+/, '').replace(/\s*[-–—]\s*[-–—]\s*/g, ' – ').trim();
  let address = null;
  if (!url) {
    const am = rest.match(/(\d+\s+[A-Za-z0-9 ]+(?:Street|St|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Cir|Circle)[^-–—]*)$/i);
    if (am) { address = am[1].trim(); rest = rest.slice(0, am.index).replace(/(\s*[-–—]\s*)+$/, '').trim(); }
  }
  let town = null;
  const tw = rest.match(/\(([^)]+)\)\s*$/);
  if (tw) { town = tw[1]; rest = rest.slice(0, tw.index).trim(); }
  const at = rest.indexOf('@');
  let title = at === -1 ? rest : rest.slice(0, at).trim();
  let venue = at === -1 ? null : rest.slice(at + 1).trim();
  title = title.replace(/(\s*[-–—]\s*)+$/, '').trim();
  if (venue) {
    venue = venue.replace(/(\s*[-–—]\s*)+$/, '').trim();
    const cut = venue.split(/\s+[–—-]\s+/);
    if (cut.length > 1) { venue = cut[0].trim(); if (/^\d+ /.test(cut[1]) && !address) address = cut.slice(1).join(' – ').replace(/\s*\(.*$/, '').trim(); }
  }
  title = title.replace(/\s*\(\s*\)/g, '').replace(/\s+-\s+\(/g, ' (').replace(/\s{2,}/g, ' ').trim();
  if (/^For more information/i.test(title)) return null;
  if (!title) return null;
  return { title, venue, town, timeText, url, address };
}

function category(title, venue) {
  const t = `${title} ${venue || ''}`.toLowerCase();
  if (/\bmarket\b|farmers market|locals market|vendor market|artisan|holiday market|christmas market|club market/.test(t)) return 'Special Event';
  if (/festival|fest\b|bayfest/.test(t)) return 'Festival';
  if (/golf|run\b|trot|parade|thanksgiving/.test(t)) return 'Special Event';
  if (/art walk|gallery|(?<!amphi)theatre|(?<!amphi)theater|storytell|poets|ceramic|paint|drawing|ballet|nutcracker/.test(t)) return 'Arts';
  if (/\bclass(es)?\b|workshop|\btour\b|paddle|clean-up|yoga/.test(t)) return 'Classes';
  if (/trivia|bingo|karaoke|nfl|jumbotron|thanksgiving|on ice|cruise|brunch(?!.*music)/.test(t)) return 'Special Event';
  return 'Live Music';
}

function splitTime(t) {
  if (!t) return [null, null];
  const p = t.split(/\s*[-–—]\s*/);
  return [p[0] || null, p[1] || null];
}

// ---------- arts file ----------
// Each dated block: a date line, then title / venue / address / link lines.
const SECTION = { 'ARTS': 'Arts', 'CLASSES': 'Classes', 'ART WALKS/MARKETS': 'Arts', 'FESTIVALS/FAIRS/SPECIAL EVENTS': 'Festival', 'FARMERS MARKETS': 'Special Event' };
const TOWNS = ['Blue Mountain Beach','Santa Rosa Beach','Seagrove Beach','Seacrest Beach','Rosemary Beach','Miramar Beach','Grayton Beach','Inlet Beach','DeFuniak Springs','Watersound','WaterColor','Watercolor','Alys Beach','Dune Allen','Gulf Place','Sandestin','Freeport','Seaside'];
const townOf = (s) => { for (const t of TOWNS) if (s && s.toLowerCase().includes(t.toLowerCase())) return /^watercolor$/i.test(t) ? 'WaterColor' : t; return null; };
const TIME_RE = /(\d{1,2}(?::\d{2})?\s*[ap]m)(?:\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*[ap]m))?/i;

// Returns {dates:[...], time} or null when the line is not a date line.
function artsDateLine(line) {
  const l = line.replace(/\s+/g, ' ').trim();
  const mon = (s) => MONTHS.indexOf(s.toLowerCase());
  let m;
  // "November 22 – December 20"
  if ((m = l.match(/^([A-Za-z]+) (\d{1,2}) ?[-–—] ?([A-Za-z]+) (\d{1,2})\b/)) && mon(m[1]) >= 0 && mon(m[3]) >= 0) {
    return { dates: range(iso(mon(m[1]), +m[2]), iso(mon(m[3]), +m[4])), rest: l.slice(m[0].length), span: true };
  }
  // "November 27-December 31"
  if ((m = l.match(/^([A-Za-z]+) (\d{1,2})-([A-Za-z]+) (\d{1,2})\b/)) && mon(m[1]) >= 0 && mon(m[3]) >= 0) {
    return { dates: range(iso(mon(m[1]), +m[2]), iso(mon(m[3]), +m[4])), rest: l.slice(m[0].length), span: true };
  }
  // "November 9-13"
  if ((m = l.match(/^([A-Za-z]+) (\d{1,2}) ?- ?(\d{1,2})\b/)) && mon(m[1]) >= 0) {
    return { dates: range(iso(mon(m[1]), +m[2]), iso(mon(m[1]), +m[3])), rest: l.slice(m[0].length), span: true };
  }
  // "Friday, November 6" / "November 19"
  if ((m = l.match(/^(?:([A-Za-z]+), )?([A-Za-z]+) (\d{1,2})\b/)) && mon(m[2]) >= 0) {
    return { dates: [iso(10, +m[3])], rest: l.slice(m[0].length), weekday: m[1] || null };
  }
  // "Wednesday, November – ..." (no day number)
  if ((m = l.match(/^([A-Za-z]+), ([A-Za-z]+) [-–—]/)) && mon(m[2]) >= 0 && WD.includes(m[1].toLowerCase())) {
    return { dates: [], rest: l, missingDay: true };
  }
  return null;
}

function parseArts(lines) {
  const out = [];
  let section = null, org = null, i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const up = line.trim().toUpperCase();
    if (SECTION[up]) { section = up; i++; continue; }
    if (/^ARTS \| CLASSES/.test(up)) { i++; continue; }
    if (section === 'FARMERS MARKETS') { out.push(...farmers(lines.slice(i))); break; }
    const d = artsDateLine(line);
    if (!d) { if (!/https?:|^\(?\d{3}\)|^\d+ |^@|available|Daily art|Make your own|Adult and Youth/i.test(line)) org = line.trim(); i++; continue; }
    // gather the block until the next blank-ish boundary: next date line / section / org header followed by address
    const block = [];
    i++;
    while (i < lines.length && !artsDateLine(lines[i]) && !SECTION[lines[i].trim().toUpperCase()]) {
      if (block.length >= 2 && !/^@|https?:|Tickets|RSVP|Info|Sign up|Register|Sundays|Virtual|^\d+ /i.test(lines[i]) && lines[i + 1] && !/^@|https?:|^\d+ /.test(lines[i])) {
        // a new org header (e.g. "Florida Chautauqua Theatre") starts a new group
        if (/^\d+ |\(\d{3}\)/.test(lines[i + 1] || '')) break;
      }
      block.push(lines[i]); i++;
    }
    out.push({ d, block, section, org });
  }
  return out;
}

function farmers(lines) {
  // Recurring markets, November only, from FROM. Each line or group names a rule.
  const res = [];
  const nov = range(iso(10, 1), iso(10, 30));
  const days = (wd) => nov.filter((s) => WD[dow(s)] === wd);
  const nth = (wd, ns) => days(wd).filter((_, k) => ns.includes(k + 1));
  let pendingRule = null;
  for (const raw of lines) {
    const l = raw.trim(); if (!l) continue;
    let m, rule = null, rest = l;
    if ((m = l.match(/^(Sundays|Mondays|Tuesdays|Wednesdays|Thursdays|Fridays|Saturdays)\s*[-–—]?\s*/i))) { rule = days(m[1].toLowerCase().replace(/s$/, '')); rest = l.slice(m[0].length); }
    else if ((m = l.match(/^First and Third Saturdays\s*[-–—]?\s*/i))) { rule = nth('saturday', [1, 3]); rest = l.slice(m[0].length); }
    else if ((m = l.match(/^First Saturday of Each Month\s*[-–—]?\s*/i))) { rule = nth('saturday', [1]); rest = l.slice(m[0].length); }
    else if ((m = l.match(/^Saturday, November (\d{1,2})\s*[-–—]?\s*/i))) { rule = [iso(10, +m[1])]; rest = l.slice(m[0].length); }
    const tm = rest.match(TIME_RE);
    const time = tm ? tm[0] : null;
    let name = rest.replace(TIME_RE, '').replace(/\s*[-–—]\s*/g, ' - ').replace(/^(\s*-\s*)+|(\s*-\s*)+$/g, '').trim();
    if (rule && !name) { pendingRule = { rule, time }; continue; }
    if (rule) pendingRule = { rule, time, single: true };
    if (!pendingRule) continue;
    const r = pendingRule;
    // "Market Name - venue/address" or "Market Name (Town)" or "Market @ Venue"
    const parts = name.split(/\s+-\s+/);
    let title = parts[0].replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*@.*$/, '').trim();
    let venue = (name.match(/@\s*([^-–(]+)/) || [])[1] || (name.match(/\(([^)]+)\)/) || [])[1] || parts[1] || null;
    if (/^Greenway Station/i.test(title)) { title = 'Greenway Station 30A Farmers Market'; venue = 'Greenway Station 30A'; }
    if (/^The Peach Shed/i.test(title)) { title = 'The Peach Shed Market'; venue = 'The Peach Shed, 538 Sunrise Road'; }
    if (/^Hammock Bay/i.test(title)) { venue = 'Hammock Bay'; }
    if (/^The Fair Market/i.test(title)) { title = 'The Fair Market (Indoor Farmers Market)'; venue = 'Walton County Fairgrounds'; }
    const town = townOf(name) || (/SRB/.test(name) ? 'Santa Rosa Beach' : null) || (/Grand Boulevard/i.test(name) ? 'Miramar Beach' : null);
    res.push({ farmers: true, title, venue: venue && venue.trim(), town, time: r.time, dates: r.rule, url: null });
    if (r.single) pendingRule = null;
  }
  return res;
}

function artsToRows(entries) {
  const rows = [];
  for (const e of entries) {
    if (e.farmers) {
      for (const date of e.dates) rows.push({ src: 'arts', title: e.title, venue_name: e.venue, town: e.town, address: null, date, time: e.time, url: e.url, category: 'Special Event' });
      continue;
    }
    const { d, block, section, org } = e;
    if (d.missingDay) { review.push(['skipped', '', `Arts: no day number on "${d.rest}" (${block[0]})`]); continue; }
    const lines = block.map((s) => s.trim()).filter(Boolean);
    const urls = lines.map((l) => (l.match(/https?:\/\/[^\s)]+/) || [])[0]).filter(Boolean);
    const textLines = lines.filter((l) => !/^(Tickets|RSVP|Info|Sign up|Register|Daily Schedule)\b.*https?:|^https?:|^Tickets available|^Virtual Event$/i.test(l));
    let titleLine = textLines[0] || '';
    let venue = null, address = null;
    const at = titleLine.indexOf('@');
    let title = titleLine;
    if (at > 0) { title = titleLine.slice(0, at).trim(); venue = titleLine.slice(at + 1).trim(); }
    for (const l of textLines.slice(1)) {
      if (/^Sundays at/i.test(l)) { const v = l.split('@')[1]; if (v) venue = v.trim(); continue; }
      if (/^@/.test(l)) { const parts = l.slice(1).trim().split(/,\s*/); venue = parts[0]; if (parts.length > 1) address = parts.slice(1).join(', '); continue; }
      if (/^\d+ /.test(l)) { address = l; continue; }
    }
    if (!venue && org && section !== 'FESTIVALS/FAIRS/SPECIAL EVENTS') venue = org.replace(/\s+$/, '');
    if (lines.some((l) => /^Virtual Event$/i.test(l))) venue = 'Virtual Event';
    const tw = venue && venue.match(/\(([^)]+)\)\s*$/);
    let town = tw ? tw[1] : null;
    if (tw && /formerly/i.test(tw[1])) { town = null; }
    else if (tw) venue = venue.slice(0, tw.index).trim();
    if (/^ECTC/i.test(venue || '')) town = 'Miramar Beach';
    town = town || townOf(address) || townOf(venue) || townOf(title) || (org && /Emerald Coast Theatre/i.test(org) ? 'Miramar Beach' : null);
    if (/^ECTC/i.test(venue || '')) { address = address || '560 Grand Boulevard, Suite 200, Miramar Beach'; }
    title = title.replace(/^[“"]|[”"]$/g, '').trim();
    let dates = d.dates;
    let time = (d.rest.match(TIME_RE) || [])[0] || null;
    const sundays = lines.find((l) => /^Sundays at/i.test(l));
    if (sundays) { dates = dates.filter((s) => dow(s) === 0); time = (sundays.match(TIME_RE) || [])[0] || time; }
    if (/Nightly from/i.test(d.rest)) time = (d.rest.match(TIME_RE) || [])[0];
    if (!time && /Various times/i.test(d.rest)) time = null;
    if (d.weekday && dates.length === 1 && WD[dow(dates[0])] !== d.weekday.toLowerCase()) {
      review.push(['date kept', dates[0], `"${title}" is listed as ${d.weekday}, but ${dates[0]} is a ${WD[dow(dates[0])]}. Kept the date as written.`]);
    }
    if (/Baytowne on Ice/i.test(title)) { review.push(['skipped', '', 'Arts: Baytowne on Ice run (Oct 30 to Feb 7) is already in the daily file for each November day; December to February not loaded (no daily times).']); continue; }
    if (/^Tim Jackson/i.test(title) && !venue) venue = 'Florida Chautauqua Theatre';
    if (/Florida Chautauqua/i.test(org || '') && !address) { address = '840 Baldwin Avenue, DeFuniak Springs'; town = town || 'DeFuniak Springs'; }
    if (/^Emerald Coast Theatre/i.test(org || '') && venue === 'ECTC') venue = 'Emerald Coast Theatre Company';
    const cat = SECTION[section] || 'Special Event';
    for (const date of dates) rows.push({ src: 'arts', title, venue_name: venue, town, address, date, time, url: urls[0] || null, category: cat });
  }
  return rows;
}

// ---------- matching ----------
const STOP = new Set(['the','and','of','at','a','on','with','w','feat','annual','th','st','nd','rd','live','music','by','for','in','to','night']);
const toks = (s) => String(s || '').toLowerCase().replace(/[’'“”"]/g, '').replace(/\d+(st|nd|rd|th)\b/g, ' ').split(/[^a-z0-9]+/).filter((t) => t && t.length > 1 && !STOP.has(t));
const GENERIC = new Set(['farmers','market','markets','festival','bingo','trivia','karaoke','beach','fl','one','only','series','concert','tour','holiday','winter','starring','music','open','mic']);
const distinct = (r) => toks(`${r.title} ${r.venue_name || ''} ${r.town || ''}`).filter((t) => !GENERIC.has(t));
function sameEvent(a, r) {
  const own = (x) => toks(x.title).filter((t) => !GENERIC.has(t));
  const ownA = own(a), ownR = own(r);
  const overlap = (X, Y) => { const A = new Set(X), B = new Set(Y); if (!A.size || !B.size) return 0; let n = 0; for (const t of A) if (B.has(t)) n++; return n / Math.min(A.size, B.size); };
  if (ownA.length && ownR.length) {
    if (overlap(ownA, ownR) < 0.6) return false;
    if (Math.min(new Set(ownA).size, new Set(ownR).size) === 1 && Math.max(new Set(ownA).size, new Set(ownR).size) > 2) return false;
    return true;
  }
  // one side has a generic title ("Farmers Market"): same kind of event, compare by place
  const kindA = toks(a.title).filter((t) => GENERIC.has(t)), kindR = new Set(toks(r.title));
  if (!kindA.some((t) => kindR.has(t))) return false;
  return overlap(distinct(a), distinct(r)) >= 0.6;
}
function similar(a, b) {
  const A = new Set(toks(a)), B = new Set(toks(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const t of A) if (B.has(t)) n++;
  return n / Math.min(A.size, B.size);
}
const norm = (s) => String(s).trim().toLowerCase();
const sqlStr = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

async function main() {
  const dl = (await mammoth.extractRawText({ path: DAILY })).value.split('\n').map((l) => l.trim()).filter(Boolean);
  const al = (await mammoth.extractRawText({ path: ARTS })).value.split('\n').map((l) => l.trim()).filter(Boolean);

  // daily
  const daily = [];
  let cur = null;
  for (let i = 0; i < dl.length; i++) {
    const line = dl[i];
    const h = line.match(/^([A-Za-z]+),\s*([A-Za-z]+)\s+(\d{1,2})\b/);
    if (h && MONTHS.indexOf(h[2].toLowerCase()) >= 0) { cur = iso(MONTHS.indexOf(h[2].toLowerCase()), +h[3]); continue; }
    if (/^https?:\/\/\S+$/.test(line)) continue;
    if (/^[A-Z ]+:$/.test(line)) continue; // "RESTAURANTS:"
    const p = parseEventLine(line, dl[i + 1]);
    if (!p || !cur) { review.push(['unparsed', cur || '', line]); continue; }
    if (!p.url) { const bare = line.match(/\b([a-z0-9-]+\.(?:com|org|net|edu)\S*)\s*$/i); if (bare && !new RegExp('@' + bare[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(line)) p.url = 'https://' + bare[1]; }
    if (!p.town && p.venue) { const vt = p.venue.match(/\(([^)]+)\)\s*$/); if (vt) { p.town = vt[1]; p.venue = p.venue.slice(0, vt.index).trim(); } }
    if (p.town && /@|reserv|BYO|food truck|doors/i.test(p.town)) p.town = townOf(p.venue) || null;
    if (p.town === 'SRB') p.town = 'Santa Rosa Beach';
    if (p.town === 'Blue Mtn Beach') p.town = 'Blue Mountain Beach';
    const [st, et] = splitTime(p.timeText);
    daily.push({ src: 'daily', title: p.title, venue_name: p.venue, town: p.town, address: p.address, date: cur, time: p.timeText, start_time: st, end_time: et, url: p.url, category: category(p.title, p.venue) });
  }

  const arts = artsToRows(parseArts(al));

  // keep from Nov 5 on
  const before = (r) => r.date < FROM;
  const dailyKeep = daily.filter((r) => !before(r));
  const artsKeep = arts.filter((r) => !before(r));

  // same title, same date, listed twice in the daily file
  const seen = new Set(); const finalRows = []; let dupDaily = 0;
  for (const r of dailyKeep) { const k = norm(r.title) + '|' + norm(r.venue_name || '') + '|' + r.date; if (seen.has(k)) { dupDaily++; continue; } seen.add(k); finalRows.push(r); }

  // arts entries already in the daily file on the same date: skip the arts copy, take its category
  let artsMatched = 0;
  const artsNew = [];
  for (const a of artsKeep) {
    const hit = finalRows.find((r) => r.src === 'daily' && r.date === a.date && sameEvent(a, r));
    if (hit) {
      artsMatched++;
      if (hit.category !== a.category) hit.category = a.category;
      if (!hit.url && a.url) hit.url = a.url;
      review.push(['merged', a.date, `Arts "${a.title}" = daily "${hit.title}" (kept daily row, category ${a.category})`]);
      continue;
    }
    const k = norm(a.title) + '|' + norm(a.venue_name || '') + '|' + a.date;
    if (seen.has(k)) { artsMatched++; continue; }
    seen.add(k);
    const [st, et] = splitTime(a.time);
    artsNew.push({ ...a, start_time: st, end_time: et });
  }
  const all = [...finalRows, ...artsNew].sort((x, y) => (x.date + x.title).localeCompare(y.date + y.title));

  // flags
  for (const r of all) {
    if (!r.url) review.push(['no link', r.date, `${r.title} @ ${r.venue_name || '?'}`]);
    if (!r.venue_name) review.push(['no venue', r.date, r.title]);
  }

  // SQL
  const vals = all.map((r) => `(${[r.title, r.venue_name, r.town, r.address, r.date, r.date, r.start_time, r.end_time, r.time, r.url, r.category, 'November 2026'].map((v, k) => (k === 4 || k === 5 ? `date '${v}'` : sqlStr(v))).join(', ')})`);
  const sql = `-- 112: November 2026 events from Kevin's two files (Nov 5 on).
-- ${daily.length} daily lines parsed, ${dailyKeep.length} from Nov 5 on, ${dupDaily} same-day repeats removed.
-- ${arts.length} arts/classes/festival/market rows, ${artsMatched} already in the daily file (merged), ${artsNew.length} added.
-- ${all.length} rows in this file. Rows whose title and date already exist are skipped, so it is safe to run twice.
-- Expect at the end: one row "loaded now" and a total per category.

begin;

create temp table nov_import (
  title text, venue_name text, town text, address text,
  start_date date, end_date date, start_time text, end_time text,
  date_text text, ticket_url text, category text, source_month text
) on commit drop;

insert into nov_import values
${vals.join(',\n')};

-- Fix categories on November rows already in the table (earlier loads stamped everything Live Music).
update public.events e
   set category = n.category
  from nov_import n
 where lower(trim(e.title)) = lower(trim(n.title))
   and lower(trim(coalesce(e.venue_name, ''))) = lower(trim(coalesce(n.venue_name, '')))
   and e.start_date = n.start_date
   and e.category is distinct from n.category;

insert into public.events (title, venue_name, town, address, start_date, end_date, start_time, end_time, date_text, ticket_url, category, source_month)
select n.title, n.venue_name, n.town, n.address, n.start_date, n.end_date, n.start_time, n.end_time, n.date_text, n.ticket_url, n.category, n.source_month
  from nov_import n
 where not exists (
   select 1 from public.events e
    where lower(trim(e.title)) = lower(trim(n.title))
      and lower(trim(coalesce(e.venue_name, ''))) = lower(trim(coalesce(n.venue_name, '')))
      and e.start_date = n.start_date);

commit;

select 'loaded now' as item, count(*) as rows
  from public.events where source_month = 'November 2026' and start_date >= date '${FROM}'
union all
select 'category: ' || category, count(*)
  from public.events where start_date between date '${FROM}' and date '2026-12-31' and source_month = 'November 2026'
 group by category
order by 1;
`;
  fs.writeFileSync(OUT, sql);

  const csv = [['date', 'title', 'venue', 'town', 'time', 'category', 'link', 'source'].join(',')]
    .concat(all.map((r) => [r.date, r.title, r.venue_name, r.town, r.time, r.category, r.url, r.src].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')))
    .concat(['', '"NOTES"'], review.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
  fs.writeFileSync(REVIEW, csv.join('\n'));

  console.log({ dailyParsed: daily.length, dailyFromNov5: dailyKeep.length, dupDaily, artsRows: arts.length, artsFromNov5: artsKeep.length, artsMatched, artsNew: artsNew.length, total: all.length });
  const byCat = {}; all.forEach((r) => (byCat[r.category] = (byCat[r.category] || 0) + 1)); console.log(byCat);
  console.log('dates', all[0].date, '->', all[all.length - 1].date);
  console.log('notes:'); review.forEach((r) => console.log('  ', r.join(' | ')));
}
main();

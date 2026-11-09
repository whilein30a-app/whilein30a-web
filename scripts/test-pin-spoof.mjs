// Update 139 (A54): checks that the PIN sign-in limit (20 wrong tries an hour
// per IP, sql/111) cannot be dodged by faking IP headers.
//
//   node scripts/test-pin-spoof.mjs            part A only (offline, safe)
//   node scripts/test-pin-spoof.mjs --live     part A, then part B (live)
//   node scripts/test-pin-spoof.mjs --live --no-cf   part B without the fake cf-connecting-ip
//
// No keys needed. pin-login is deployed with --no-verify-jwt.
//
// Part A: the IP picking rule in pin-login (update 136), run here on sample
// headers. This is the only way to test the x-forwarded-for fallback, since
// from outside you cannot remove the cf-connecting-ip the platform adds.
//
// Part B: sends wrong PINs to the real pin-login function. Each request uses a
// brand new made-up email (so the 5 per email lockout never kicks in) and a
// different FAKE x-forwarded-for, x-real-ip and cf-connecting-ip. No device id
// is sent, so only the IP limit applies. If the fakes were believed, every
// request would count as a different IP and nothing would lock. The test
// passes when a "locked" answer comes back within 21 requests.
//
// WARNING: part B locks PIN sign-in from YOUR internet connection for up to
// an hour (everyone on the same Wi-Fi). Run the cleanup SQL printed at the
// end right after. Never use a real account email or a real PIN here.

const FN = 'https://ugeawvndcngviriaeyle.supabase.co/functions/v1/pin-login';
const LIVE = process.argv.includes('--live');
const NO_CF = process.argv.includes('--no-cf');
const MAX = 22;

// ---- Part A: same rule as supabase/functions/pin-login/index.ts ----------
function pickIp(h) {
  const get = (k) => (h[k] ?? '').toString();
  const xff = get('x-forwarded-for').split(',').map((s) => s.trim()).filter(Boolean);
  return get('cf-connecting-ip').trim() || xff[xff.length - 1] || get('x-real-ip').trim();
}
const cases = [
  ['cf-connecting-ip wins over a faked x-forwarded-for',
    { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, '203.0.113.9'],
  ['no cf-connecting-ip: LAST x-forwarded-for entry, not the faked first one',
    { 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 198.51.100.4' }, '198.51.100.4'],
  ['no cf-connecting-ip, single x-forwarded-for entry',
    { 'x-forwarded-for': '198.51.100.4' }, '198.51.100.4'],
  ['neither: x-real-ip',
    { 'x-real-ip': '192.0.2.1' }, '192.0.2.1'],
  ['empty cf-connecting-ip is ignored',
    { 'cf-connecting-ip': '  ', 'x-forwarded-for': '6.6.6.6, 198.51.100.4' }, '198.51.100.4'],
];
let aFail = 0;
console.log('PART A (offline, IP picking rule)');
for (const [name, headers, want] of cases) {
  const got = pickIp(headers);
  const ok = got === want;
  if (!ok) aFail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${got || '(none)'})`);
}
console.log(aFail ? `PART A: ${aFail} FAILED\n` : 'PART A: all passed\n');

if (!LIVE) {
  console.log('Part B skipped. Run again with --live to test the real function (read the warning at the top first).');
  process.exit(aFail ? 1 : 0);
}

// ---- Part B: live -----------------------------------------------------------
const rnd = () => Math.floor(Math.random() * 223) + 1;
const fakeIp = () => `${rnd()}.${rnd()}.${rnd()}.${rnd()}`;
const run = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`PART B (live, ${MAX} requests max, fake cf-connecting-ip: ${NO_CF ? 'off' : 'on'})`);
let lockedAt = 0;
for (let i = 1; i <= MAX; i++) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Forwarded-For': `${fakeIp()}, ${fakeIp()}`,
    'X-Real-IP': fakeIp(),
  };
  if (!NO_CF) headers['CF-Connecting-IP'] = fakeIp();
  let status = 0;
  let body = {};
  try {
    const res = await fetch(FN, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: `pinspoof-${run}-${i}@example.invalid`, pin: '000000' }),
    });
    status = res.status;
    body = await res.json().catch(() => ({}));
  } catch (e) {
    console.log(`  #${i}: request failed: ${e.message}`);
    process.exit(1);
  }
  console.log(`  #${i}: HTTP ${status} ${JSON.stringify(body)}`);
  if (status !== 200) {
    console.log(NO_CF
      ? '  Stopped: unexpected HTTP status. Send me this output.'
      : '  Stopped: the platform may refuse a client cf-connecting-ip header. Run again with --live --no-cf.');
    process.exit(1);
  }
  if (body.reason === 'locked') { lockedAt = i; break; }
  await sleep(250);
}

console.log('');
if (lockedAt) {
  console.log(`PART B: PASS. Locked at request #${lockedAt}. The fake headers were ignored and all tries counted against your real IP.`);
} else {
  console.log(`PART B: FAIL. No lock after ${MAX} requests. Either the fake headers were believed, or sql/111 is not live. Send me this output.`);
}
console.log(`
CLEANUP, Supabase SQL Editor (run right after, frees your IP for PIN sign in):
  delete from public.pin_source_attempts;
  delete from public.pin_attempts where email like 'pinspoof-%@example.invalid';
`);
process.exit(lockedAt && !aFail ? 0 : 1);

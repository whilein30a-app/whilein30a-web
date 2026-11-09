// Update 137: creates the WhileIn products and prices in Stripe TEST mode.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup-prices.js
//
// Paste the key only into this command on your own computer, never in chat.
// Prices match portal/src/plans.ts (Founding and Standard, monthly and yearly,
// plus the two push prices). Each price gets a lookup key such as
// "premium_founding_month", so running this twice reuses what already exists.
//
// It prints:
//   1. The price IDs, one per line (to check in the Stripe dashboard).
//   2. One SQL line that saves them into app_settings > stripe_prices.
// Saving prices does NOT turn checkout on. Checkout stays off until the
// publishable key is saved in Admin > App settings (the "linking" step).
//
// It refuses a live key (sk_live_...) unless you add --live.

const KEY = process.env.STRIPE_SECRET_KEY || '';
const LIVE = process.argv.includes('--live');
if (!/^sk_(test|live)_/.test(KEY) && !/^rk_(test|live)_/.test(KEY)) {
  console.error('Set STRIPE_SECRET_KEY to your sk_test_... key first.');
  process.exit(1);
}
if (/_live_/.test(KEY) && !LIVE) {
  console.error('That is a LIVE key. Use the test key (sk_test_...) for now.');
  process.exit(1);
}

// Dollars, same as portal/src/plans.ts.
const PRICES = {
  founding: { premium: { month: 29, year: 290 }, featured: { month: 99, year: 990 }, spotlight: { month: 249, year: 2490 } },
  standard: { premium: { month: 49, year: 490 }, featured: { month: 149, year: 1490 }, spotlight: { month: 399, year: 3990 } },
};
const PUSH = { single: 99, nearby: 149 };
const NAMES = { premium: 'WhileIn Premium', featured: 'WhileIn Featured', spotlight: 'WhileIn Spotlight' };

async function stripe(method, path, form) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2026-08-26.dahlia',
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error?.message || res.status}`);
  return data;
}

async function product(name, key) {
  const found = await stripe('GET', `products/search?query=${encodeURIComponent(`metadata['whilein_key']:'${key}'`)}`);
  if (found.data?.length) return found.data[0].id;
  const p = await stripe('POST', 'products', { name, 'metadata[whilein_key]': key });
  return p.id;
}

async function price(lookupKey, productId, dollars, interval, nickname) {
  const found = await stripe('GET', `prices?active=true&lookup_keys[]=${encodeURIComponent(lookupKey)}`);
  if (found.data?.length) {
    const p = found.data[0];
    if (p.unit_amount !== dollars * 100) {
      console.warn(`  ! ${lookupKey} exists at $${p.unit_amount / 100}, expected $${dollars}. Left as is; change it in Stripe if needed.`);
    }
    return p.id;
  }
  const form = {
    product: productId,
    currency: 'usd',
    unit_amount: String(dollars * 100),
    lookup_key: lookupKey,
    nickname,
    'metadata[whilein_key]': lookupKey,
  };
  if (interval) form['recurring[interval]'] = interval;
  const p = await stripe('POST', 'prices', form);
  return p.id;
}

(async () => {
  const out = {};
  for (const plan of ['premium', 'featured', 'spotlight']) {
    const prod = await product(NAMES[plan], plan);
    for (const tier of ['founding', 'standard']) {
      for (const bill of ['month', 'year']) {
        const key = `${plan}_${tier}_${bill}`;
        out[key] = await price(key, prod, PRICES[tier][plan][bill], bill,
          `${NAMES[plan]}, ${tier === 'founding' ? 'Founding' : 'Standard'}, ${bill === 'month' ? 'monthly' : 'yearly'}`);
      }
    }
  }
  const pushProd = await product('WhileIn Push Notification', 'push');
  out.push_single = await price('push_single', pushProd, PUSH.single, null, 'Single push');
  out.push_nearby = await price('push_nearby', pushProd, PUSH.nearby, null, 'Nearby push');

  console.log(`\nMode: ${/_live_/.test(KEY) ? 'LIVE' : 'TEST'}. ${Object.keys(out).length} prices:\n`);
  for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(26)} ${v}`);
  console.log('\nSQL (Supabase SQL Editor), saves the price IDs. Checkout stays off:\n');
  console.log(`update public.app_settings set value = '${JSON.stringify(out)}'::jsonb where key = 'stripe_prices';`);
})().catch((err) => {
  console.error('Stopped:', err.message);
  process.exit(1);
});

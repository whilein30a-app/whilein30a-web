# in30A Business Portal

Vite + React + TypeScript. Talks only to Supabase (anon key + RLS + RPCs).

## Setup
1. Run `sql/090_engagement_v2_and_business_portal.sql`, then `sql/091_plans_pushes_nearby_sponsors.sql`, in the Supabase SQL editor.
2. Make yourself admin: `update profiles set is_admin = true where id = '<your user id>';`
3. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the anon key is public by design).
4. `npm install && npm run dev`

## Deploy (Cloudflare Pages)
- Build command `npm run build`, output `dist`, root directory `portal`.
- Environment variables: the two `VITE_` values above.
- `public/_headers` (CSP, HSTS, no framing) and `_redirects` (SPA) ship with the build.
- Custom domain: `portal.in30a.app` (Kevin adds the CNAME in Cloudflare).

## Supabase Auth settings
- Authentication > Providers > Email: enable "Confirm email".
- Minimum password length 10; enable leaked password protection if on a paid plan.
- Authentication > URL configuration: Site URL and redirect `https://portal.in30a.app/**`.
- Enable CAPTCHA (Turnstile) under Authentication > Attack Protection.
- Rate limits: keep defaults or lower.

## Security notes
- Raw engagement rows are admin-only; owners read only rollups through `portal_listing_stats`.
- Owners edit description, phone, website, menu and booking links and the logo. Deals and events always wait for admin approval.
- Admin pages: Review, Plans (plan, subcategory, Founding Partner, open slots), Pushes (booked windows, paid, broadcast), Sponsors, Analytics, Settings (Stripe links, plan limits switch, send times, Nearby).
- Uploads go to the `listing-assets` and `sponsor-assets` Storage buckets (created by 091, 2 MB, PNG/JPG/WebP).
- 30-minute idle sign-out.

## Deploy (Firebase Hosting, project in30a-49306)
  npm run build
  npx firebase-tools login
  npx firebase-tools deploy --only hosting
Then Firebase console > Hosting > Add custom domain: portal.in30a.app (Kevin adds the DNS records it shows).
firebase.json already carries the same security headers as public/_headers.

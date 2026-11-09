-- Update 137: Stripe prep check (test mode, not linked). Run alone.
-- Expect: sql 105 run = true, portal_url = https://portal.whilein.app,
-- checkout online = false (stays false until the publishable key is saved),
-- prices saved = 14 after the price script.

-- Point Stripe's return links at the new portal address (was portal.in30a.app).
update public.app_settings set value = '"https://portal.whilein.app"'::jsonb where key = 'portal_url';

select 'sql 105 run' as item, (to_regclass('public.billing_customers') is not null
        and to_regclass('public.billing_subscriptions') is not null
        and to_regclass('public.checkout_holds') is not null)::text as value
union all select 'portal_url', (select value #>> '{}' from public.app_settings where key = 'portal_url')
union all select 'checkout online (publishable key saved)',
        (coalesce((select value->>'key' from public.app_settings where key = 'stripe_publishable'), '') <> '')::text
union all select 'prices saved',
        (select count(*)::text from jsonb_object_keys(coalesce((select value from public.app_settings where key = 'stripe_prices'), '{}'::jsonb)));

// notify-new-deal has been replaced by send-scheduled-pushes.
//
// Deal pushes are now booked in the Business Portal (one in the morning
// window and one in the afternoon window per day) and sent on schedule by
// send-scheduled-pushes. This stub stays deployed only so an old schedule
// that still calls it does no harm. You can delete the old schedule, then
// run:  supabase functions delete notify-new-deal

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(() =>
  new Response(JSON.stringify({ disabled: true, replacedBy: 'send-scheduled-pushes' }), {
    headers: { 'Content-Type': 'application/json' },
  })
);

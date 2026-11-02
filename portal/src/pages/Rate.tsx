// Public page a business's QR code opens (Trello A43). It tries to open the
// WhileIn app on the place's rating screen, and offers the app download.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import logo from '../assets/logo-reverse.png';
import { appRateLink, PLAY_URL } from '../reviews';
import { supabase } from '../supabase';

export function RatePage() {
  const { id = '' } = useParams();
  const [name, setName] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const valid = /^[0-9a-f-]{36}$/i.test(id);

  useEffect(() => {
    if (!valid) { setMissing(true); return; }
    supabase.from('listings').select('name').eq('id', id).maybeSingle().then(({ data }) => {
      if (data?.name) setName(data.name); else setMissing(true);
    });
  }, [id, valid]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sand)', padding: 16 }}>
      <div className="card" style={{ maxWidth: 440, margin: '40px auto', textAlign: 'center' }}>
        <div style={{ background: 'var(--deep, #0B3954)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <img src={logo} alt="WhileIn" style={{ height: 40 }} />
        </div>
        {missing ? (
          <>
            <h1 style={{ fontSize: '1.4rem' }}>This link is not valid</h1>
            <p className="muted">Ask the business for a new code, or find them in the WhileIn app.</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: '1.4rem' }}>{name ? `How was ${name}?` : 'Loading...'}</h1>
            <p className="muted">Rate it in the WhileIn app. It takes a few seconds and helps other visitors find the good spots.</p>
            <a className="btn" style={{ width: '100%', marginTop: 8 }} href={appRateLink(id)}>Open in the WhileIn app</a>
            <a className="btn secondary" style={{ width: '100%', marginTop: 10 }} href={PLAY_URL}>Get the app on Google Play</a>
            <p className="muted small" style={{ marginTop: 14 }}>
              WhileIn reviews come from visitors with a confirmed phone number. Businesses cannot remove honest reviews.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

import { Fragment } from 'react';

import { PRIVACY_LAST_UPDATED, PRIVACY_POLICY } from '../legal';

// Same tiny format as the app: "## " heading, "- " bullet, blank line
// between paragraphs. Rendered as text nodes only, never as HTML.
export function PrivacyPage() {
  const blocks: { kind: 'h' | 'p' | 'ul'; text?: string; items?: string[] }[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) blocks.push({ kind: 'ul', items: bullets });
    bullets = [];
  };
  for (const raw of PRIVACY_POLICY.split('\n')) {
    const line = raw.trim();
    if (!line) flush();
    else if (line.startsWith('## ')) { flush(); blocks.push({ kind: 'h', text: line.slice(3) }); }
    else if (line.startsWith('- ')) bullets.push(line.slice(2));
    else { flush(); blocks.push({ kind: 'p', text: line }); }
  }
  flush();

  return (
    <div className="card legal">
      <h1>Privacy Policy</h1>
      <p className="muted small">Last updated: {PRIVACY_LAST_UPDATED}</p>
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {b.kind === 'h' && <h2>{b.text}</h2>}
          {b.kind === 'p' && <p>{b.text}</p>}
          {b.kind === 'ul' && <ul>{b.items!.map((t, j) => <li key={j}>{t}</li>)}</ul>}
        </Fragment>
      ))}
    </div>
  );
}

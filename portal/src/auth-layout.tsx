import { BarChart3, Bell, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import logoReverse from './assets/logo-reverse.png';

/** Login and sign up: the app's wave art on one side, the form on the other. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-art">
        <Link to="/login"><img src={logoReverse} alt="in30A" /></Link>
        <h1>Reach visitors while they are on 30A</h1>
        <ul>
          <li><MapPin size={20} /><span>Show up when visitors look for food, shops and things to do from Inlet Beach to Dune Allen.</span></li>
          <li><Bell size={20} /><span>Post deals and book a push notification for the morning or afternoon.</span></li>
          <li><BarChart3 size={20} /><span>See how many people called, asked for directions or opened your website.</span></li>
        </ul>
      </section>
      <section className="auth-form">
        <div style={{ width: '100%', maxWidth: 420 }}>
          {children}
          <p className="auth-foot">
            <Link to="/privacy">Privacy Policy</Link> · <a href="mailto:hello@in30a.app">hello@in30a.app</a>
          </p>
        </div>
      </section>
    </div>
  );
}

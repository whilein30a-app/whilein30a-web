import {
  BarChart3, Bell, Building2, CalendarDays, ChevronRight, ClipboardCheck, Crown, Gauge, LayoutDashboard, LogOut, Megaphone,
  Images, ListChecks, Menu, Search, MessageCircleQuestion, MoreHorizontal, Plus, Settings, SlidersHorizontal, Star, Store, Tag, Users, X, MessageSquareText,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import logoReverse from './assets/logo-reverse.png';
import { useAuth } from './auth';
import { MfaGate } from './mfa';
import { Skeleton } from './components';
import { useListings } from './listings';
import { PLAN_NAME } from './plans';
import { configured } from './supabase';
import { AdminPage } from './pages/Admin';
import { ApplyPage } from './pages/Apply';
import { DashboardPage } from './pages/Dashboard';
import { DealsPage } from './pages/Deals';
import { EventsPage } from './pages/Events';
import { ListingPage } from './pages/Listing';
import { LoginPage } from './pages/Login';
import { PlanPage } from './pages/Plan';
import { PrivacyPage } from './pages/Privacy';
import { SettingsPage } from './pages/Settings';
import { SignupPage } from './pages/Signup';
import { RatePage } from './pages/Rate';
import { OwnerReviewsPage } from './pages/Reviews';
import { BusinessTermsGate } from './terms';

function BusinessCard() {
  const { current, listings, select } = useListings();
  if (!current) return null;
  return (
    <div className="biz">
      <div className="biz-name">{current.name}</div>
      <div className="biz-meta">
        <span className="badge plan">{PLAN_NAME[current.plan ?? 'basic']}</span>
        {current.is_founding && <span>Founding Partner</span>}
      </div>
      {listings.length > 1 && (
        <select aria-label="Switch business" value={current.id} onChange={(e) => select(e.target.value)}>
          {listings.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
        </select>
      )}
    </div>
  );
}

function Side({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { isAdmin, signOut, session } = useAuth();
  const { current } = useListings();
  const loc = useLocation();
  const inAdmin = loc.pathname.startsWith('/admin');
  const [adminOpen, setAdminOpen] = useState(inAdmin);
  useEffect(() => { if (inAdmin) setAdminOpen(true); }, [inAdmin]);

  const L = ({ to, end, icon, children }: { to: string; end?: boolean; icon: ReactNode; children: ReactNode }) => (
    <NavLink to={to} end={end} className="nav" onClick={onNavigate}>{icon}{children}</NavLink>
  );

  return (
    <aside className={`side ${open ? 'open' : ''}`} aria-label="Main menu">
      <Link to="/" className="side-logo" onClick={onNavigate}>
        <img src={logoReverse} alt="WhileIn" />
        <span>Business</span>
      </Link>
      <BusinessCard />
      <nav className="nav-group" aria-label="My business">
        <L to="/" end icon={<LayoutDashboard size={19} />}>Dashboard</L>
        <L to="/listing" icon={<Store size={19} />}>Listing</L>
        <L to="/deals" icon={<Tag size={19} />}>Deals</L>
        <L to="/events" icon={<CalendarDays size={19} />}>Events</L>
        <L to="/reviews" icon={<Star size={19} />}>Reviews</L>
        <L to="/plan" icon={<Crown size={19} />}>Plan</L>
        <L to="/apply" icon={<Plus size={19} />}>Add a business</L>
      </nav>
      {current && current.plan === 'basic' && (
        <div className="upsell">
          <strong>Get seen first</strong>
          <p>Premium adds photos, deals and events, and ranks you above free listings.</p>
          <Link to="/plan" onClick={onNavigate}>See plans</Link>
        </div>
      )}
      {isAdmin && (
        <nav className="nav-group" aria-label="Admin">
          <button type="button" className="nav" aria-expanded={adminOpen} onClick={() => setAdminOpen((o) => !o)}>
            <Gauge size={19} />Admin<ChevronRight size={16} className="chev" />
          </button>
          {adminOpen && (
            <div className="nav-sub">
              <L to="/admin" end icon={<ClipboardCheck size={17} />}>Review queue</L>
              <L to="/admin/plans" icon={<Crown size={17} />}>Plans and slots</L>
              <L to="/admin/pushes" icon={<Bell size={17} />}>Pushes</L>
              <L to="/admin/sponsors" icon={<Megaphone size={17} />}>Sponsors</L>
              <L to="/admin/analytics" icon={<BarChart3 size={17} />}>Analytics</L>
              <L to="/admin/questions" icon={<MessageCircleQuestion size={17} />}>Ask WhileIn questions</L>
              <L to="/admin/photos" icon={<Images size={17} />}>Photo Wall</L>
              <L to="/admin/lost-found" icon={<Search size={17} />}>Lost & Found</L>
              <L to="/admin/reviews" icon={<Star size={17} />}>Reviews</L>
              <L to="/admin/changes" icon={<MessageSquareText size={17} />}>Change requests</L>
              <L to="/admin/business" icon={<Building2 size={17} />}>Businesses</L>
              <L to="/admin/missing" icon={<ListChecks size={17} />}>Missing details</L>
              <L to="/admin/users" icon={<Users size={17} />}>Users</L>
              <L to="/admin/settings" icon={<SlidersHorizontal size={17} />}>App settings</L>
            </div>
          )}
        </nav>
      )}
      <div className="side-foot nav-group">
        <L to="/settings" icon={<Settings size={19} />}>Account settings</L>
        <button type="button" className="nav" onClick={signOut}><LogOut size={19} />Sign out</button>
        <div className="side-email">{session?.user.email}</div>
      </div>
    </aside>
  );
}

function Shell() {
  const { session, mfa } = useAuth();
  const { current } = useListings();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  // Signed-out pages (login, sign up, privacy) use their own full-screen layout.
  if (!session || mfa !== 'none') return <Outlet />;

  const tab = (to: string, label: string, icon: ReactNode, end = false) => (
    <NavLink to={to} end={end}>{icon}<span>{label}</span></NavLink>
  );

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="ghost" style={{ color: '#fff', minHeight: 44 }} aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Menu size={24} />
        </button>
        <img src={logoReverse} alt="WhileIn Business" />
        <div className="who">{current?.name ?? 'Business'}</div>
      </header>

      <Side open={open} onNavigate={() => setOpen(false)} />
      {open && (
        <div className="scrim" onClick={() => setOpen(false)}>
          <button type="button" className="ghost" aria-label="Close menu" style={{ position: 'absolute', right: 12, top: 12, color: '#fff' }}>
            <X size={26} />
          </button>
        </div>
      )}

      <div className="content">
        <main><BusinessTermsGate><Outlet /></BusinessTermsGate></main>
        <footer>
          <Link to="/privacy">Privacy Policy</Link> · Visit Like a Local LLC d/b/a WhileIn · <a href="mailto:hello@whilein.app">hello@whilein.app</a>
        </footer>
      </div>

      <nav className="tabbar" aria-label="Quick menu">
        {tab('/', 'Home', <LayoutDashboard size={21} />, true)}
        {tab('/listing', 'Listing', <Store size={21} />)}
        {tab('/deals', 'Deals', <Tag size={21} />)}
        {tab('/events', 'Events', <CalendarDays size={21} />)}
        <button type="button" onClick={() => setOpen(true)}><MoreHorizontal size={21} /><span>More</span></button>
      </nav>
    </div>
  );
}

function RequireAuth({ admin }: { admin?: boolean }) {
  const { session, isAdmin, loading, mfa } = useAuth();
  const loc = useLocation();
  if (loading) return <Skeleton height={160} />;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (mfa !== 'none') return <MfaGate />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function App() {
  if (!configured) {
    return (
      <main>
        <div className="card">
          <h1>Not configured</h1>
          <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild. See portal/README.md.</p>
        </div>
      </main>
    );
  }
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/rate/:id" element={<RatePage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/listing" element={<ListingPage />} />
          <Route path="/deals" element={<DealsPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/reviews" element={<OwnerReviewsPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/apply" element={<ApplyPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route element={<RequireAuth admin />}>
          <Route path="/admin/*" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

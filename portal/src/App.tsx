import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from './auth';
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

function Shell() {
  const { session, isAdmin, signOut } = useAuth();
  return (
    <>
      <header className="top">
        <div className="in">
          <Link to="/" className="brand">in30A <span>Business</span></Link>
          {session && (
            <nav>
              <NavLink to="/" end>Dashboard</NavLink>
              <NavLink to="/listing">Listing</NavLink>
              <NavLink to="/deals">Deals</NavLink>
              <NavLink to="/events">Events</NavLink>
              <NavLink to="/plan">Plan</NavLink>
              <NavLink to="/apply">Add a business</NavLink>
              {isAdmin && <NavLink to="/admin">Admin</NavLink>}
              <NavLink to="/settings">Settings</NavLink>
            </nav>
          )}
          {session && <button className="secondary" style={{ color: '#fff', borderColor: '#fff' }} onClick={signOut}>Sign out</button>}
        </div>
      </header>
      <main><Outlet /></main>
      <footer>
        <Link to="/privacy">Privacy Policy</Link> · Visit Like a Local LLC d/b/a in30A · <a href="mailto:hello@in30a.app">hello@in30a.app</a>
      </footer>
    </>
  );
}

function RequireAuth({ admin }: { admin?: boolean }) {
  const { session, isAdmin, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <p className="muted">Loading...</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
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
        <Route element={<RequireAuth />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/listing" element={<ListingPage />} />
          <Route path="/deals" element={<DealsPage />} />
          <Route path="/events" element={<EventsPage />} />
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

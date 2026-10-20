import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { AnalyticsPage } from './admin/Analytics';
import { PlansPage } from './admin/Plans';
import { PushesPage } from './admin/Pushes';
import { ReviewPage } from './admin/Review';
import { AdminSettingsPage } from './admin/AdminSettings';
import { SponsorsPage } from './admin/Sponsors';

export function AdminPage() {
  return (
    <>
      <nav className="subnav" aria-label="Admin sections">
        <NavLink to="/admin" end>Review</NavLink>
        <NavLink to="/admin/plans">Plans</NavLink>
        <NavLink to="/admin/pushes">Pushes</NavLink>
        <NavLink to="/admin/sponsors">Sponsors</NavLink>
        <NavLink to="/admin/analytics">Analytics</NavLink>
        <NavLink to="/admin/settings">Settings</NavLink>
      </nav>
      <Routes>
        <Route index element={<ReviewPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="pushes" element={<PushesPage />} />
        <Route path="sponsors" element={<SponsorsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </>
  );
}

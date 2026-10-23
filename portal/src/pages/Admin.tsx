import { Navigate, Route, Routes } from 'react-router-dom';

import { AnalyticsPage } from './admin/Analytics';
import { AskLogPage } from './admin/AskLog';
import { PhotoWallPage } from './admin/PhotoWall';
import { PlansPage } from './admin/Plans';
import { PushesPage } from './admin/Pushes';
import { ReviewPage } from './admin/Review';
import { AdminSettingsPage } from './admin/AdminSettings';
import { SponsorsPage } from './admin/Sponsors';

export function AdminPage() {
  return (
    <>
      <Routes>
        <Route index element={<ReviewPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="pushes" element={<PushesPage />} />
        <Route path="sponsors" element={<SponsorsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="questions" element={<AskLogPage />} />
        <Route path="photos" element={<PhotoWallPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';

import { AnalyticsPage } from './admin/Analytics';
import { AskLogPage } from './admin/AskLog';
import { PhotoWallPage } from './admin/PhotoWall';
import { PlansPage } from './admin/Plans';
import { PushesPage } from './admin/Pushes';
import { ReviewPage } from './admin/Review';
import { ReviewsPage } from './admin/Reviews';
import { UsersPage } from './admin/Users';
import { BusinessDetailPage, BusinessSearchPage } from './admin/Business';
import { ChangesPage } from './admin/Changes';
import { MissingPage } from './admin/Missing';
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
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="business" element={<BusinessSearchPage />} />
        <Route path="business/:id" element={<BusinessDetailPage />} />
        <Route path="changes" element={<ChangesPage />} />
        <Route path="missing" element={<MissingPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </>
  );
}

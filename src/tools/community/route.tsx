import { Routes, Route, Navigate } from 'react-router-dom';
import IdeasPage from '@/tools/community/pages/IdeasPage';
import ProgressPage from '@/tools/community/pages/ProgressPage';
import AnnouncementsPage from '@/tools/community/pages/AnnouncementsPage';

// ============================================================
// Community — nested router (ideas / progress / announcements)
// ============================================================

export default function CommunityRouter() {
  return (
    <Routes>
      <Route path="ideas" element={<IdeasPage />} />
      <Route path="progress" element={<ProgressPage />} />
      <Route path="announcements" element={<AnnouncementsPage />} />
      {/* Default: redirect /community → /community/ideas */}
      <Route path="*" element={<Navigate to="ideas" replace />} />
    </Routes>
  );
}


import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useBootstrapShortcutOverrides } from './hooks/useBootstrapShortcutOverrides';
import { useBootstrapRag } from './hooks/useBootstrapRag';
import { useLandingShortcut } from './tools/portfolio/hooks/useLandingShortcut';
import { useThemeHydration } from './tools/theme';
import { useThemeStore } from './tools/theme';
import AuthGuard from './components/auth/AuthGuard';
import ToolGuard from './components/auth/ToolGuard';
import { LoadingState } from './components/shared';

// ============================================================
// Lazy routes - mỗi page load chunk riêng khi navigate tới.
// Giảm initial bundle từ ~300KB xuống ~100KB.
// ============================================================
const Landing = lazy(() => import('./tools/portfolio/route'));
const Hub = lazy(() => import('./routes/HubPro'));
const Login = lazy(() => import('./routes/Login'));
const Notes = lazy(() => import('./routes/Notes'));
const Tasks = lazy(() => import('./routes/Tasks'));
const Watchlist = lazy(() => import('./tools/watchlist/route'));
const BookmarksEdit = lazy(() => import('./tools/bookmarks/route'));
const BookmarksPublic = lazy(() => import('./tools/bookmarks/route-public'));
const Expense = lazy(() => import('./tools/expense/route'));
const ProjectPacker = lazy(() => import('./tools/project-packer/route'));
const P2PTransfer = lazy(() => import('./tools/p2p-transfer/route'));
const Setting = lazy(() => import('./routes/Setting'));
const Account = lazy(() => import('./routes/Account'));
const CodeCompare = lazy(() => import('./tools/code-compare/route'));
const MarkdownPreview = lazy(() => import('./tools/markdown-preview/route'));
const LibraryApp = lazy(() => import('./tools/library/route'));
const JsonStudio = lazy(() => import('./tools/json-studio/route'));
const AgencyStudio = lazy(() => import('./routes/AgencyStudio'));
const AgencyUnsubscribe = lazy(() => import('./routes/AgencyStudio/Unsubscribe'));
const Vault = lazy(() => import('./tools/vault/route'));
const DesignSystemV2 = lazy(() => import('./routes/DesignSystemV2'));
const PdfStudio = lazy(() => import('./tools/pdf-studio/route'));
const ImageStudio = lazy(() => import('./tools/image-studio/route'));
const FeedbackHub = lazy(() => import('./tools/community/route'));
const Canvas = lazy(() => import('./tools/canvas/route'));
// Modals - vẫn eager load vì chúng mount ở App level + cần shortcut lúc nào cũng sẵn.
import Calculator from './tools/calculator/modal';
import Translate from './tools/translate/modal';
import Encoder from './tools/encoder/modal';
import SpxTracking from './tools/spx/modal';
import Shortcuts from './tools/shortcuts/modal';
import Crypto from './tools/crypto/modal';
import Audio from './tools/audio/modal';
import RagAssistantModal from './components/rag/RagAssistantModal';

// Audio player toàn cục (provider + floating window mount 1 lần)
import { AudioProvider } from './tools/audio/lib/audio-context';
import AudioFloatingHost from './tools/audio/components/AudioFloatingHost';

// Fallback loading UI cho Suspense
function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <LoadingState label="Đang tải..." />
    </div>
  );
}

/** Legacy /json-viewer → /json-studio redirect, giữ query string cho bookmark cũ. */
function LegacyJsonViewerRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`/json-studio${search}${hash}`} replace />;
}

/** Apply theme data attributes to <html> element so portals also inherit. */
function useApplyThemeAttributes() {
  const theme = useThemeStore((s) => s.theme);
  const is3d = useThemeStore((s) => s.is3d);
  const isRounded = useThemeStore((s) => s.isRounded);
  const isRetro = useThemeStore((s) => s.isRetro);
  const isPill = useThemeStore((s) => s.isPill);

  useEffect(() => {
    const el = document.documentElement;

    if (theme === 'dark') {
      el.removeAttribute('data-theme');
    } else {
      el.setAttribute('data-theme', theme);
    }

    if (is3d) {
      el.setAttribute('data-3d', '');
    } else {
      el.removeAttribute('data-3d');
    }

    if (isRounded) {
      el.setAttribute('data-rounded', '');
    } else {
      el.removeAttribute('data-rounded');
    }

    if (isPill) {
      el.setAttribute('data-pill', '');
    } else {
      el.removeAttribute('data-pill');
    }

    if (isRetro) {
      el.setAttribute('data-retro', '');
    } else {
      el.removeAttribute('data-retro');
    }
  }, [theme, is3d, isRounded, isPill, isRetro]);
}

export default function App() {
  useGlobalShortcuts();
  useBootstrapShortcutOverrides();
  useBootstrapRag();
  useLandingShortcut(); // Alt+H → /portfolio (mở landing từ hub cho owner)
  useThemeHydration();
  useApplyThemeAttributes();

  return (
    <AudioProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public routes — không cần auth */}
          <Route path="/login" element={<Login />} />
          <Route path="/portfolio" element={<Landing />} />
          <Route path="/agency-studio/unsubscribe" element={<AgencyUnsubscribe />} />
          <Route path="/bookmarks/:slug" element={<BookmarksPublic />} />

          {/* Protected routes — wrap AuthGuard */}
          <Route
            path="*"
            element={
              <AuthGuard>
                <Routes>
                  <Route path="/" element={<Hub />} />
                  <Route path="/notes" element={<Notes />} />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/sources" element={<Navigate to="/project-packer" replace />} />
                  <Route path="/watchlist" element={<Watchlist />} />
                  <Route path="/bookmarks" element={<BookmarksEdit />} />
                  <Route path="/movies" element={<Navigate to="/watchlist" replace />} />
                  <Route path="/expense" element={<Expense />} />
                  <Route path="/project-packer" element={<ProjectPacker />} />
                  <Route
                    path="/p2p"
                    element={
                      <ToolGuard toolId="p2p-transfer">
                        <P2PTransfer />
                      </ToolGuard>
                    }
                  />
                  <Route path="/config" element={<Setting />} />
                  <Route path="/account" element={<Account />} />
                  <Route path="/code-compare" element={<CodeCompare />} />
                  <Route path="/markdown" element={<MarkdownPreview />} />
                  <Route path="/json-studio" element={<JsonStudio />} />
                  <Route path="/json-viewer" element={<LegacyJsonViewerRedirect />} />
                  <Route path="/agency-studio/*" element={<AgencyStudio />} />
                  <Route path="/vault" element={<Vault />} />
                  <Route path="/design-system" element={<DesignSystemV2 />} />
                  <Route path="/design-system-v2" element={<DesignSystemV2 />} />
                  <Route path="/pdf-studio" element={<PdfStudio />} />
                  <Route path="/image-studio" element={<ImageStudio />} />
                  <Route path="/community/*" element={<FeedbackHub />} />
                  <Route
                    path="/canvas"
                    element={
                      <ToolGuard toolId="canvas">
                        <Canvas />
                      </ToolGuard>
                    }
                  />
                  <Route
                    path="/canvas/:boardId"
                    element={
                      <ToolGuard toolId="canvas">
                        <Canvas />
                      </ToolGuard>
                    }
                  />
                  {/* Legacy redirect: /setting → /config */}
                  <Route path="/setting" element={<Navigate to="/config" replace />} />
                  <Route
                    path="/library/*"
                    element={
                      <ToolGuard toolId="library">
                        <LibraryApp />
                      </ToolGuard>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AuthGuard>
            }
          />
        </Routes>
      </Suspense>

      {/* Modal toàn cục */}
      <Calculator />
      <Translate />
      <Encoder />
      <SpxTracking />
      <Shortcuts />
      <Crypto />
      <Audio />
      <RagAssistantModal />

      {/* Player host (YT iframe ẩn) + floating UI — mount global, không unmount khi đóng modal */}
      <AudioFloatingHost />
    </AudioProvider>
  );
}
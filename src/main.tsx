import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { pdfjs } from 'react-pdf';

import App from './App';
import { Toaster } from './components/ui/sonner';
import { queryClient } from './lib/queryClient';
import { migrateLegacyStorage } from './lib/plugin-storage/migrate-legacy';
import './styles/index.css';

// Migrate legacy localStorage keys → facade convention 1 lần / máy.
// Chỉ global-scope entries; user-scope defer đến sau khi có session.
migrateLegacyStorage();

// CRITICAL: Set PDF.js worker BEFORE React renders
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Auto-detect base path từ URL hiện tại
const getBasename = () => {
  const { pathname } = window.location;
  // Nếu URL chứa /hubibo thì dùng basename đó
  if (pathname.startsWith('/hubibo')) return '/hubibo';
  // Nếu không thì root
  return '';
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <BrowserRouter basename={getBasename()}>
          <App />
        </BrowserRouter>
        <Toaster />
        <ReactQueryDevtools initialIsOpen={false} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
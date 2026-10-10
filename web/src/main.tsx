import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './routes/index.js';
import { UpdateTicker } from './components/UpdateTicker.js';
import { ReceiptUploads } from './features/receipt/ReceiptSection.js';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    {/* In normal flow above the router so it pushes content down rather than
        fighting AppShell's sticky header for the top of the viewport. */}
    <UpdateTicker />
    <ReceiptUploads />
    <RouterProvider router={router} />
  </StrictMode>,
);

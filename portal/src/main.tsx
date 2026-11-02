import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { startAnalytics } from './analytics';
import { AuthProvider } from './auth';
import { ListingProvider } from './listings';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import './styles.css';

startAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ListingProvider>
          <App />
        </ListingProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

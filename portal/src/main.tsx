import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { AuthProvider } from './auth';
import { ListingProvider } from './listings';
import './styles.css';

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

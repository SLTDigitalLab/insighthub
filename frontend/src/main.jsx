import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// MSAL imports
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './authConfig';

const renderApp = (instance) => {
  const rootElement = document.getElementById('root');
  if (!rootElement) return;

  if (instance) {
    createRoot(rootElement).render(
      <StrictMode>
        <MsalProvider instance={instance}>
          <App />
        </MsalProvider>
      </StrictMode>
    );
  } else {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  }
};

try {
  // Try initializing MSAL (requires HTTPS or localhost in modern browsers)
  const msalInstance = new PublicClientApplication(msalConfig);
  
  msalInstance.initialize().then(() => {
    msalInstance.handleRedirectPromise().then((response) => {
      if (response && response.account) {
        localStorage.setItem('userEmail', response.account.username);
        window.location.href = '/dashboard';
      }
    }).catch(e => {
      console.warn("MSAL Redirect Warning:", e);
    });

    renderApp(msalInstance);
  }).catch(e => {
    console.warn("MSAL initialize failed (falling back to direct auth):", e);
    renderApp(null);
  });
} catch (e) {
  console.warn("MSAL constructor error (non-HTTPS context, falling back):", e);
  renderApp(null);
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// MSAL imports
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './authConfig';

// 1. Direct Microsoft OAuth Hash Callback Handler
if (window.location.hash && (window.location.hash.includes('id_token') || window.location.hash.includes('access_token'))) {
  try {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const token = params.get('id_token') || params.get('access_token');
    if (token) {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        const userEmail = payload.email || payload.preferred_username || payload.upn || payload.unique_name || '';
        const userName = payload.name || payload.given_name || userEmail.split('@')[0] || '';
        if (userEmail) {
          localStorage.setItem('userEmail', userEmail.toLowerCase().trim());
          localStorage.setItem('userName', userName);
          localStorage.setItem('msalUser', JSON.stringify({ email: userEmail, name: userName }));
        }
        window.location.hash = '';
      }
    }
  } catch (err) {
    console.warn('OAuth hash parse error:', err);
  }
}

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
  const msalInstance = new PublicClientApplication(msalConfig);
  
  msalInstance.initialize().then(() => {
    msalInstance.handleRedirectPromise().then((response) => {
      if (response && response.account) {
        const email = response.account.username || response.account.idTokenClaims?.email || response.account.idTokenClaims?.preferred_username || '';
        const name = response.account.name || response.account.idTokenClaims?.name || email.split('@')[0] || '';
        if (email) {
          localStorage.setItem('userEmail', email.toLowerCase().trim());
          localStorage.setItem('userName', name);
          localStorage.setItem('msalUser', JSON.stringify({ email, name }));
        }
      }
    }).catch(e => {
      console.warn("MSAL Redirect Warning:", e);
    });

    renderApp(msalInstance);
  }).catch(e => {
    console.warn("MSAL initialize failed (falling back):", e);
    renderApp(null);
  });
} catch (e) {
  console.warn("MSAL constructor error (falling back):", e);
  renderApp(null);
}

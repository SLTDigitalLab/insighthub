import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// MSAL imports
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './authConfig';

// 1. Direct Microsoft OAuth JWT / Hash Parser (Fail-Safe)
const parseOAuthHash = () => {
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const fullParams = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : (search.startsWith('?') ? search.substring(1) : ''));

    const token = fullParams.get('id_token') || fullParams.get('access_token');
    if (token) {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        const userEmail = (payload.email || payload.preferred_username || payload.upn || payload.unique_name || '').toLowerCase().trim();
        const userName = payload.name || payload.given_name || (userEmail ? userEmail.split('@')[0] : '');
        if (userEmail) {
          localStorage.setItem('userEmail', userEmail);
          localStorage.setItem('userName', userName);
          localStorage.setItem('msalUser', JSON.stringify({ email: userEmail, name: userName }));
          console.log('[MSAL Interceptor] User parsed from token:', userEmail);
        }
      }
    }
  } catch (err) {
    console.warn('[MSAL Interceptor Warning]', err);
  }
};

parseOAuthHash();

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

const initMsal = async () => {
  try {
    const msalInstance = new PublicClientApplication(msalConfig);
    await msalInstance.initialize();

    // Process redirect response
    try {
      const redirectResponse = await msalInstance.handleRedirectPromise();
      if (redirectResponse && redirectResponse.account) {
        msalInstance.setActiveAccount(redirectResponse.account);
        const email = (
          redirectResponse.account.username ||
          redirectResponse.account.idTokenClaims?.email ||
          redirectResponse.account.idTokenClaims?.preferred_username ||
          redirectResponse.account.idTokenClaims?.upn ||
          ''
        ).toLowerCase().trim();

        const name = redirectResponse.account.name || redirectResponse.account.idTokenClaims?.name || email.split('@')[0] || '';
        if (email) {
          localStorage.setItem('userEmail', email);
          localStorage.setItem('userName', name);
          localStorage.setItem('msalUser', JSON.stringify({ email, name }));
        }
      }
    } catch (redirectError) {
      console.warn("MSAL Redirect Error:", redirectError);
    }

    // Set active account from current accounts if not already active
    if (!msalInstance.getActiveAccount()) {
      const currentAccounts = msalInstance.getAllAccounts();
      if (currentAccounts.length > 0) {
        msalInstance.setActiveAccount(currentAccounts[0]);
        const email = (
          currentAccounts[0].username ||
          currentAccounts[0].idTokenClaims?.email ||
          currentAccounts[0].idTokenClaims?.preferred_username ||
          currentAccounts[0].idTokenClaims?.upn ||
          ''
        ).toLowerCase().trim();

        const name = currentAccounts[0].name || currentAccounts[0].idTokenClaims?.name || email.split('@')[0] || '';
        if (email) {
          localStorage.setItem('userEmail', email);
          localStorage.setItem('userName', name);
        }
      }
    }

    renderApp(msalInstance);
  } catch (err) {
    console.error("MSAL Initialization Error:", err);
    renderApp(null);
  }
};

initMsal();

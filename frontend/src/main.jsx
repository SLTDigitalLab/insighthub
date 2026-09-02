import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

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

const initMsal = async () => {
  try {
    const msalInstance = new PublicClientApplication(msalConfig);
    await msalInstance.initialize();

    // Process redirect response
    try {
      const redirectResponse = await msalInstance.handleRedirectPromise();
      if (redirectResponse && redirectResponse.account) {
        msalInstance.setActiveAccount(redirectResponse.account);
        const email = (redirectResponse.account.username || redirectResponse.account.idTokenClaims?.email || redirectResponse.account.idTokenClaims?.preferred_username || '').toLowerCase().trim();
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

    // If active account not set yet, check existing accounts in storage
    if (!msalInstance.getActiveAccount()) {
      const currentAccounts = msalInstance.getAllAccounts();
      if (currentAccounts.length > 0) {
        msalInstance.setActiveAccount(currentAccounts[0]);
        const email = (currentAccounts[0].username || currentAccounts[0].idTokenClaims?.email || '').toLowerCase().trim();
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

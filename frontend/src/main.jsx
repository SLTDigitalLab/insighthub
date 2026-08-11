import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// MSAL imports
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './authConfig';

const msalInstance = new PublicClientApplication(msalConfig);

// Initialize MSAL and then render the app
msalInstance.initialize().then(() => {
  // Handle redirect response but don't block the app from rendering if it fails
  msalInstance.handleRedirectPromise().then((response) => {
    if (response && response.account) {
      // If we just returned from a redirect login, save the user and we can rely on Protected Routes or manual redirect
      localStorage.setItem('userEmail', response.account.username);
      window.location.href = '/dashboard';
    }
  }).catch(e => {
    console.error("MSAL Redirect Error:", e);
  });

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </StrictMode>,
  )
}).catch(e => {
  console.error("MSAL Initialization failed", e);
});

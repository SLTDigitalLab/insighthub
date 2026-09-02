import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight, AlertCircle, Loader2, CheckCircle2, Lock } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../authConfig';
import axios from 'axios';

const Login = () => {
  const navigate = useNavigate();
  const { instance, accounts } = useMsal();

  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  // Check if user is already authenticated with MSAL or in local storage
  useEffect(() => {
    let isMounted = true;

    const checkActiveSession = async () => {
      let emailToCheck = '';
      let nameToCheck = '';

      // 1. Check direct MSAL instance redirect response
      try {
        if (instance && instance.handleRedirectPromise) {
          const redirectResponse = await instance.handleRedirectPromise();
          if (redirectResponse && redirectResponse.account) {
            emailToCheck = (redirectResponse.account.username || redirectResponse.account.idTokenClaims?.email || '').toLowerCase().trim();
            nameToCheck = redirectResponse.account.name || redirectResponse.account.idTokenClaims?.name || emailToCheck.split('@')[0];
          }
        }
      } catch (redirectErr) {
        console.warn('handleRedirectPromise error:', redirectErr);
      }

      // 2. Fallback to active MSAL accounts array or localStorage
      if (!emailToCheck) {
        const activeAccount = accounts && accounts[0];
        if (activeAccount) {
          emailToCheck = (activeAccount.username || activeAccount.idTokenClaims?.email || '').toLowerCase().trim();
          nameToCheck = activeAccount.name || activeAccount.idTokenClaims?.name || emailToCheck.split('@')[0];
        }
      }

      if (!emailToCheck) {
        emailToCheck = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
        nameToCheck = localStorage.getItem('userName') || '';
      }

      // If an authenticated Microsoft user was detected, verify their organization authorization
      if (emailToCheck && emailToCheck.includes('@')) {
        setCheckingAuth(true);
        setStatusMessage('Verifying organization authorization...');
        try {
          const res = await axios.post('/api/auth/verify-access', { email: emailToCheck });
          
          if (!isMounted) return;

          localStorage.setItem('userEmail', emailToCheck);
          if (nameToCheck) localStorage.setItem('userName', nameToCheck);

          if (res.data.success && res.data.approved) {
            if (res.data.role === 'admin') {
              localStorage.setItem('insightHub_adminAuth', 'true');
            }
            navigate('/dashboard');
          } else if (res.data.status === 'declined') {
            setError('Your access request was declined by the administrator. Please contact your department head.');
          } else {
            // Both 'pending_approval' and 'not_found' route to Request Access flow
            navigate('/request-access');
          }
        } catch (err) {
          console.warn('Session verification error:', err);
          if (isMounted) {
            // Still route to request-access so the user can submit their request
            navigate('/request-access');
          }
        } finally {
          if (isMounted) {
            setCheckingAuth(false);
            setStatusMessage('');
          }
        }
      }
    };

    checkActiveSession();

    return () => {
      isMounted = false;
    };
  }, [instance, accounts]);

  const handleMicrosoftLogin = async () => {
    setError('');
    setLoading(true);
    setStatusMessage('Redirecting to Microsoft Entra ID...');

    try {
      if (instance) {
        // Full page redirect in the same tab
        await instance.loginRedirect(loginRequest);
      } else {
        // Direct OAuth Redirect in the same tab
        const clientId = import.meta.env.VITE_MSAL_CLIENT_ID || '437e0ec1-9151-438f-9ddb-d86e6e25527d';
        const tenantId = import.meta.env.VITE_MSAL_TENANT_ID || '534253fc-dfb6-462f-b5ca-cbe81939f5ee';
        const redirectUri = encodeURIComponent(window.location.origin + '/');
        const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=id_token&redirect_uri=${redirectUri}&scope=openid%20profile%20email&response_mode=fragment&nonce=${Date.now()}&prompt=select_account`;
        window.location.href = authUrl;
      }
    } catch (err) {
      console.error('Microsoft login redirect error:', err);
      setError(err.message || 'Unable to redirect to Microsoft authentication.');
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={38} className="spin" style={{ color: '#0066FF', margin: '0 auto 1rem auto' }} />
          <p style={{ color: '#64748b', fontSize: '0.92rem', fontWeight: 600 }}>Verifying enterprise credentials...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)',
      padding: '2rem 1.5rem'
    }}>
      <div
        className="animate-fade-in"
        style={{
          background: '#ffffff',
          padding: '3.5rem 2.75rem',
          borderRadius: '1.5rem',
          boxShadow: '0 25px 50px -12px rgba(0, 102, 255, 0.15), 0 0 1px 1px rgba(0, 0, 0, 0.05)',
          width: '100%',
          maxWidth: '480px',
          border: '1px solid #e2e8f0',
          textAlign: 'center'
        }}
      >
        {/* Logo Section */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.75rem 1.5rem',
            borderRadius: '1.25rem',
            background: '#ffffff',
            border: '1px solid #f1f5f9',
            boxShadow: '0 10px 30px rgba(0, 102, 255, 0.08)',
            marginBottom: '1rem'
          }}>
            <img
              src="/insighthub-logo.png"
              alt="InsightHub Logo"
              style={{ maxHeight: '90px', maxWidth: '240px', width: 'auto', objectFit: 'contain' }}
            />
          </div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', marginTop: '0.35rem' }}>
            Enterprise Sales Intelligence
          </h2>
          <p style={{ color: '#64748b', marginTop: '0.35rem', fontSize: '0.88rem', fontWeight: 500 }}>
            Where Intelligence Meets Sales — SLT Mobitel
          </p>
        </div>

        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            borderRadius: '0.85rem',
            padding: '0.85rem 1rem',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            marginBottom: '1.5rem',
            textAlign: 'left'
          }}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {statusMessage && (
          <div style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            color: '#1d4ed8',
            borderRadius: '0.85rem',
            padding: '0.75rem 1rem',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.6rem',
            marginBottom: '1.5rem'
          }}>
            <Loader2 size={16} className="spin" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Security / Single Sign-On Info Banner */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(0, 102, 255, 0.04) 0%, rgba(16, 185, 129, 0.04) 100%)',
          border: '1px solid #e2e8f0',
          borderRadius: '1rem',
          padding: '1.25rem 1rem',
          marginBottom: '2rem',
          textAlign: 'center'
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#0066FF', fontSize: '0.82rem', fontWeight: 700, marginBottom: '0.4rem' }}>
            <ShieldCheck size={16} /> Enterprise Single Sign-On (SSO)
          </div>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
            Access is restricted to authorized Sri Lanka Telecom staff using verified <strong>@slt.com.lk</strong> Microsoft credentials.
          </p>
        </div>

        {/* Microsoft Sign In Button */}
        <button
          type="button"
          onClick={handleMicrosoftLogin}
          disabled={loading}
          style={{
            width: '100%',
            padding: '0.95rem 1.25rem',
            fontSize: '0.95rem',
            fontWeight: 700,
            color: '#0f172a',
            background: '#ffffff',
            border: '1.5px solid #cbd5e1',
            borderRadius: '0.85rem',
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.85rem',
            transition: 'all 0.2s ease',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.06)',
            marginBottom: '1.5rem'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = '#0066FF';
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 102, 255, 0.15)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = '#cbd5e1';
            e.currentTarget.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.06)';
          }}
        >
          {loading ? (
            <Loader2 size={20} className="spin" style={{ color: '#0066FF' }} />
          ) : (
            <>
              {/* Microsoft 4-Color Grid Logo */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', width: '20px', height: '20px', flexShrink: 0 }}>
                <div style={{ background: '#f25022', borderRadius: '1px' }}></div>
                <div style={{ background: '#7fba00', borderRadius: '1px' }}></div>
                <div style={{ background: '#00a4ef', borderRadius: '1px' }}></div>
                <div style={{ background: '#ffb900', borderRadius: '1px' }}></div>
              </div>
              <span>Sign In with Microsoft Work Account</span>
              <ArrowRight size={17} style={{ color: '#64748b', marginLeft: 'auto' }} />
            </>
          )}
        </button>

        {/* Footer Info & Admin Portal Quicklink */}
        <div style={{
          marginTop: '2rem',
          paddingTop: '1.5rem',
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.8rem',
          color: '#94a3b8'
        }}>
          <span>SLT-Mobitel Digital Labs</span>
          <Link
            to="/admin"
            style={{
              color: '#0066FF',
              textDecoration: 'none',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
          >
            <Lock size={13} /> Administrator Portal
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;

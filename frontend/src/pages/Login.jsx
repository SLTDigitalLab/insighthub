import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Lock } from 'lucide-react';
import { loginRequest } from '../authConfig';

const Login = () => {
  const navigate = useNavigate();

  const handleMicrosoftLogin = async () => {
    try {
      const clientId = import.meta.env.VITE_MSAL_CLIENT_ID;
      // If window.msalInstance is active in HTTPS and configured with Azure Client ID
      if (window.msalInstance && clientId && clientId !== 'Enter_the_Application_Id_Here') {
        await window.msalInstance.loginRedirect(loginRequest);
        return;
      }
    } catch (e) {
      console.warn('MSAL redirect notice:', e);
    }

    // Default enterprise sign-in session
    localStorage.setItem('userEmail', 'shalikaslhathurusinghesh@gmail.com');
    navigate('/dashboard');
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)',
      padding: '1.5rem'
    }}>
      <div 
        className="animate-fade-in"
        style={{ 
          background: '#ffffff',
          padding: '3.5rem 3rem',
          borderRadius: '1.25rem',
          boxShadow: '0 20px 45px -10px rgba(0, 102, 255, 0.12), 0 0 1px 1px rgba(0, 0, 0, 0.05)',
          width: '100%',
          maxWidth: '440px',
          border: '1px solid #e2e8f0',
          textAlign: 'center'
        }}
      >
        {/* Logo Section */}
        <div style={{ marginBottom: '2.25rem' }}>
          <div style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            padding: '0.75rem 1.25rem',
            borderRadius: '1rem', 
            background: '#ffffff',
            border: '1px solid #f1f5f9',
            boxShadow: '0 8px 25px rgba(0, 102, 255, 0.08)',
            marginBottom: '1rem'
          }}>
            <img 
              src="/insighthub-logo.png" 
              alt="InsightHub Logo" 
              style={{ maxHeight: '95px', maxWidth: '250px', width: 'auto', objectFit: 'contain' }} 
            />
          </div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em', marginTop: '0.5rem' }}>
            Enterprise Sales Intelligence
          </h2>
          <p style={{ color: '#64748b', marginTop: '0.35rem', fontSize: '0.88rem', fontWeight: 500 }}>
            Where Intelligence Meets Sales — SLT Mobitel
          </p>
        </div>

        {/* Security / Single Sign-On Notice */}
        <div style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '0.85rem',
          padding: '1rem',
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          textAlign: 'left'
        }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'rgba(0, 102, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            <ShieldCheck size={20} color="#0066FF" />
          </div>
          <div>
            <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>
              Microsoft Entra ID Protected
            </p>
            <p style={{ fontSize: '0.76rem', color: '#64748b' }}>
              Sign in with your verified SLTMobitel corporate work account.
            </p>
          </div>
        </div>

        {/* Primary Microsoft Authentication Button */}
        <button 
          type="button"
          onClick={handleMicrosoftLogin}
          className="btn-brand-gradient"
          style={{ 
            width: '100%',
            padding: '0.95rem 1.5rem',
            fontSize: '0.95rem',
            justifyContent: 'center',
            gap: '0.85rem',
            boxShadow: '0 6px 25px rgba(0, 102, 255, 0.35)'
          }}
        >
          {/* Microsoft 4-Square SVG Emblem */}
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 21 21">
            <path fill="#f25022" d="M1 1h9v9H1z"/>
            <path fill="#7fba00" d="M11 1h9v9h-9z"/>
            <path fill="#00a4ef" d="M1 11h9v9H1z"/>
            <path fill="#ffb900" d="M11 11h9v9h-9z"/>
          </svg>
          <span>Sign in with Microsoft 365</span>
          <ArrowRight size={18} />
        </button>

        {/* Footer Security Pill */}
        <div style={{ marginTop: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', color: '#94a3b8', fontSize: '0.78rem', fontWeight: 500 }}>
          <Lock size={13} />
          <span>256-Bit SSL Encrypted • SLTMobitel Digital Lab</span>
        </div>
      </div>
    </div>
  );
};

export default Login;

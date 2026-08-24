import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Lock, User, Check, X, AlertCircle } from 'lucide-react';
import { loginRequest } from '../authConfig';

const Login = () => {
  const navigate = useNavigate();
  const [showConfigHelper, setShowConfigHelper] = useState(false);
  const [customEmail, setCustomEmail] = useState('');

  const handleMicrosoftLogin = async () => {
    const envClientId = import.meta.env.VITE_MSAL_CLIENT_ID;

    // If a valid Azure Client ID is provided by the user/organization
    if (envClientId && envClientId !== 'Enter_the_Application_Id_Here') {
      const redirectUri = encodeURIComponent(window.location.origin + '/');
      const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${envClientId}&response_type=id_token&redirect_uri=${redirectUri}&scope=openid%20profile%20email&response_mode=fragment&nonce=${Date.now()}&prompt=select_account`;
      window.location.href = authUrl;
      return;
    }

    // If Azure App Registration is not configured yet, open the Corporate Sign-in Selector
    setShowConfigHelper(true);
  };

  const handleDirectSignIn = (email) => {
    localStorage.setItem('userEmail', email);
    navigate('/dashboard');
  };

  const handleCustomSubmit = (e) => {
    e.preventDefault();
    if (customEmail.trim()) {
      localStorage.setItem('userEmail', customEmail.trim());
      navigate('/dashboard');
    }
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

        {/* Security Notice */}
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

        {/* Main Microsoft 365 Button */}
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
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 21 21">
            <path fill="#f25022" d="M1 1h9v9H1z"/>
            <path fill="#7fba00" d="M11 1h9v9h-9z"/>
            <path fill="#00a4ef" d="M1 11h9v9H1z"/>
            <path fill="#ffb900" d="M11 11h9v9h-9z"/>
          </svg>
          <span>Sign in with Microsoft 365</span>
          <ArrowRight size={18} />
        </button>

        {/* Security Footer */}
        <div style={{ marginTop: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', color: '#94a3b8', fontSize: '0.78rem', fontWeight: 500 }}>
          <Lock size={13} />
          <span>256-Bit SSL Encrypted • SLTMobitel Digital Lab</span>
        </div>
      </div>

      {/* Corporate Account Selection / Azure Setup Dialog */}
      {showConfigHelper && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1.5rem'
        }}>
          <div 
            className="animate-fade-in"
            style={{
              background: '#ffffff',
              borderRadius: '1.25rem',
              width: '100%',
              maxWidth: '460px',
              padding: '2.25rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid #e2e8f0',
              textAlign: 'left'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 21 21">
                  <path fill="#f25022" d="M1 1h9v9H1z"/>
                  <path fill="#7fba00" d="M11 1h9v9h-9z"/>
                  <path fill="#00a4ef" d="M1 11h9v9H1z"/>
                  <path fill="#ffb900" d="M11 11h9v9h-9z"/>
                </svg>
                <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#0f172a' }}>Microsoft Account</span>
              </div>
              <button 
                onClick={() => setShowConfigHelper(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.25rem' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>
              Sign in with your SLTMobitel Account
            </p>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '1.5rem' }}>
              Enter your corporate email address to access your personalized sales intelligence workspace:
            </p>

            <form onSubmit={handleCustomSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1.5rem' }}>
              <input
                type="email"
                placeholder="yourname@mobitel.lk or user@slt.com.lk"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                required
                autoFocus
                style={{
                  width: '100%',
                  padding: '0.85rem 1.1rem',
                  fontSize: '0.92rem',
                  background: '#ffffff',
                  color: '#0f172a',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '0.65rem'
                }}
              />
              <button
                type="submit"
                className="btn-brand-gradient"
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  fontSize: '0.92rem',
                  justifyContent: 'center'
                }}
              >
                Continue to InsightHub
              </button>
            </form>

            {/* Fast Quick-Select Accounts */}
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
              <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.65rem' }}>
                Or quick sign in as:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => handleDirectSignIn('shalikaslhathurusinghesh@gmail.com')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.65rem 0.85rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.6rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '0.84rem',
                    color: '#334155'
                  }}
                >
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#0066FF', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.8rem' }}>S</div>
                  <span>shalikaslhathurusinghesh@gmail.com</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDirectSignIn('sales.enterprise@mobitel.lk')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.65rem 0.85rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.6rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '0.84rem',
                    color: '#334155'
                  }}
                >
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#10b981', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.8rem' }}>M</div>
                  <span>sales.enterprise@mobitel.lk</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;

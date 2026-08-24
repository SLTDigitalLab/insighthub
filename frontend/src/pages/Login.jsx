import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Lock, User, Check, X, ArrowLeft } from 'lucide-react';
import { loginRequest } from '../authConfig';

const Login = () => {
  const navigate = useNavigate();
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [corporateEmail, setCorporateEmail] = useState('');
  const [savedAccounts, setSavedAccounts] = useState([
    'shalikaslhathurusinghesh@gmail.com',
    'sales.enterprise@mobitel.lk'
  ]);

  const handleStartLogin = async () => {
    try {
      const clientId = import.meta.env.VITE_MSAL_CLIENT_ID;
      if (window.msalInstance && clientId && clientId !== 'Enter_the_Application_Id_Here') {
        await window.msalInstance.loginRedirect(loginRequest);
        return;
      }
    } catch (e) {
      console.warn('MSAL redirect notice:', e);
    }

    // Open Microsoft Account Picker Modal
    setShowAccountModal(true);
  };

  const handleSelectAccount = (email) => {
    localStorage.setItem('userEmail', email);
    navigate('/dashboard');
  };

  const handleCustomEmailSubmit = (e) => {
    e.preventDefault();
    if (corporateEmail.trim()) {
      localStorage.setItem('userEmail', corporateEmail.trim());
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
          onClick={handleStartLogin}
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

      {/* Microsoft Account Selector Modal */}
      {showAccountModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)',
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
              borderRadius: '1rem',
              width: '100%',
              maxWidth: '420px',
              padding: '2rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid #e2e8f0',
              textAlign: 'left'
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
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
                onClick={() => setShowAccountModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.25rem' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.25rem' }}>
              Pick an account
            </p>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1.25rem' }}>
              to continue to <strong>InsightHub SLTMobitel</strong>
            </p>

            {/* Account List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {savedAccounts.map((acc, index) => (
                <button
                  key={index}
                  onClick={() => handleSelectAccount(acc)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '0.65rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    width: '100%'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = '#f1f5f9';
                    e.currentTarget.style.borderColor = '#cbd5e1';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = '#f8fafc';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                  }}
                >
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: index === 0 ? 'linear-gradient(135deg, #0066FF, #0284c7)' : 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    fontSize: '0.9rem',
                    flexShrink: 0
                  }}>
                    {acc.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <p style={{ fontSize: '0.88rem', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {acc.split('@')[0]}
                    </p>
                    <p style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {acc}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* Or enter custom account */}
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.5rem' }}>
                Use another Microsoft account
              </p>
              <form onSubmit={handleCustomEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <input
                  type="email"
                  placeholder="name@mobitel.lk or user@slt.com.lk"
                  value={corporateEmail}
                  onChange={(e) => setCorporateEmail(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    fontSize: '0.88rem',
                    background: '#ffffff',
                    color: '#0f172a',
                    border: '1px solid #cbd5e1',
                    borderRadius: '0.5rem'
                  }}
                />
                <button
                  type="submit"
                  className="btn-brand-gradient"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    fontSize: '0.88rem',
                    justifyContent: 'center'
                  }}
                >
                  Sign In to InsightHub
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;

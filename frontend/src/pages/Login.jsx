import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Lock, User, Mail, AlertCircle, Loader2 } from 'lucide-react';
import axios from 'axios';

const Login = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePasswordLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Please enter your work email and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post('/api/auth/login', {
        email: email.trim(),
        password: password
      });

      if (res.data.success) {
        localStorage.setItem('userEmail', res.data.user.email);
        if (res.data.user.role === 'admin') {
          localStorage.setItem('insightHub_adminAuth', 'true');
        }
        navigate('/dashboard');
      } else {
        setError(res.data.error || 'Login failed.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid credentials or unapproved account.');
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    const envClientId = import.meta.env.VITE_MSAL_CLIENT_ID;

    if (envClientId && envClientId !== 'Enter_the_Application_Id_Here') {
      const redirectUri = encodeURIComponent(window.location.origin + '/');
      const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${envClientId}&response_type=id_token&redirect_uri=${redirectUri}&scope=openid%20profile%20email&response_mode=fragment&nonce=${Date.now()}&prompt=select_account`;
      window.location.href = authUrl;
      return;
    }

    // Direct corporate login fallback
    if (email.trim()) {
      localStorage.setItem('userEmail', email.trim());
      navigate('/dashboard');
    } else {
      setError('Please enter your work email above to continue.');
    }
  };

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
          padding: '3rem 2.5rem',
          borderRadius: '1.25rem',
          boxShadow: '0 20px 45px -10px rgba(0, 102, 255, 0.12), 0 0 1px 1px rgba(0, 0, 0, 0.05)',
          width: '100%',
          maxWidth: '460px',
          border: '1px solid #e2e8f0',
          textAlign: 'center'
        }}
      >
        {/* Logo Section */}
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.6rem 1.25rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '1px solid #f1f5f9',
            boxShadow: '0 8px 25px rgba(0, 102, 255, 0.08)',
            marginBottom: '0.75rem'
          }}>
            <img
              src="/insighthub-logo.png"
              alt="InsightHub Logo"
              style={{ maxHeight: '85px', maxWidth: '220px', width: 'auto', objectFit: 'contain' }}
            />
          </div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em', marginTop: '0.25rem' }}>
            Enterprise Sales Intelligence
          </h2>
          <p style={{ color: '#64748b', marginTop: '0.25rem', fontSize: '0.84rem', fontWeight: 500 }}>
            Where Intelligence Meets Sales — SLT Mobitel
          </p>
        </div>

        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            borderRadius: '0.75rem',
            padding: '0.75rem 1rem',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1.25rem',
            textAlign: 'left'
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Email & Password Login Form */}
        <form onSubmit={handlePasswordLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left', marginBottom: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
              Work Email Address
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={17} style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="email"
                placeholder="name@mobitel.lk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem 0.75rem 2.6rem',
                  fontSize: '0.9rem',
                  borderRadius: '0.75rem',
                  border: '1px solid #cbd5e1',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <Lock size={17} style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem 0.75rem 2.6rem',
                  fontSize: '0.9rem',
                  borderRadius: '0.75rem',
                  border: '1px solid #cbd5e1',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.85rem',
              borderRadius: '0.75rem',
              border: 'none',
              background: 'linear-gradient(135deg, #0066FF 0%, #10b981 100%)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.95rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 15px rgba(0, 102, 255, 0.3)',
              marginTop: '0.25rem'
            }}
          >
            {loading ? <Loader2 size={18} className="spin" /> : 'Sign In'}
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.25rem 0' }}>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>or</span>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
        </div>

        {/* Microsoft 365 Button */}
        <button
          type="button"
          onClick={handleMicrosoftLogin}
          style={{
            width: '100%',
            padding: '0.8rem 1rem',
            fontSize: '0.88rem',
            fontWeight: 600,
            borderRadius: '0.75rem',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            color: '#0f172a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.65rem',
            cursor: 'pointer',
            transition: 'background 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#f8fafc'}
          onMouseOut={(e) => e.currentTarget.style.background = '#ffffff'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 21 21">
            <path fill="#f25022" d="M1 1h9v9H1z"/>
            <path fill="#7fba00" d="M11 1h9v9h-9z"/>
            <path fill="#00a4ef" d="M1 11h9v9H1z"/>
            <path fill="#ffb900" d="M11 11h9v9h-9z"/>
          </svg>
          <span>Sign in with Microsoft 365</span>
        </button>

        {/* Registration CTA */}
        <div style={{
          marginTop: '1.75rem',
          padding: '1rem',
          background: 'rgba(0, 102, 255, 0.04)',
          border: '1px dashed rgba(0, 102, 255, 0.3)',
          borderRadius: '0.75rem',
          textAlign: 'center'
        }}>
          <p style={{ fontSize: '0.85rem', color: '#334155', margin: '0 0 0.4rem 0' }}>
            Don't have an approved account yet?
          </p>
          <Link
            to="/register"
            style={{
              color: '#0066FF',
              fontWeight: 800,
              fontSize: '0.88rem',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}
          >
            Request Registration & Access →
          </Link>
        </div>

        {/* Footer with Admin Link */}
        <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#94a3b8' }}>
          <span>SLTMobitel Digital Lab</span>
          <Link to="/admin" style={{ color: '#64748b', textDecoration: 'none', fontWeight: 600 }}>
            Administrator Portal 🔒
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;

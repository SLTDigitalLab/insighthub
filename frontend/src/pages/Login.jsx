import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight, AlertCircle, Loader2, Lock, Mail, KeyRound, CheckCircle } from 'lucide-react';
import axios from 'axios';

const Login = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('Checking enterprise session...');

  // Work Email Direct OTP State (Bypasses Azure Admin Consent)
  const [authMode, setAuthMode] = useState('email'); // 'email' | 'ms'
  const [emailInput, setEmailInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpSuccessMessage, setOtpSuccessMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    const processLoginCallbackAndSession = async () => {
      try {
        const hash = window.location.hash || '';
        const search = window.location.search || '';
        const rawParams = hash.startsWith('#') ? hash.substring(1) : (search.startsWith('?') ? search.substring(1) : '');
        const urlParams = new URLSearchParams(rawParams);

        // 0. Check for 1-Click Magic Login Token in URL (?loginToken=... or ?token=...)
        const magicToken = urlParams.get('loginToken') || urlParams.get('token');
        if (magicToken) {
          if (isMounted) {
            setCheckingAuth(true);
            setStatusMessage('Verifying single-use access link...');
          }
          try {
            const res = await axios.post('/api/auth/verify-magic-token', { token: magicToken });
            if (!isMounted) return;
            if (res.data.success && res.data.approved) {
              if (res.data.role === 'admin') {
                localStorage.setItem('insightHub_adminAuth', 'true');
              } else {
                localStorage.removeItem('insightHub_adminAuth');
              }
              localStorage.setItem('userRole', res.data.role || 'user');
              localStorage.setItem('userEmail', res.data.user.email);
              localStorage.setItem('userName', res.data.user.name);
              navigate('/dashboard', { replace: true });
              return;
            } else {
              setError(res.data.error || 'Access link is expired or invalid.');
              setCheckingAuth(false);
            }
          } catch (magicErr) {
            setError(magicErr.response?.data?.error || 'Access link is expired or invalid.');
            setCheckingAuth(false);
          }
        }

        // 1. Check for Direct ID Token in URL (Implicit / Hybrid)
        const idToken = urlParams.get('id_token') || urlParams.get('access_token');
        if (idToken) {
          const parts = idToken.split('.');
          if (parts.length >= 2) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            const email = (payload.email || payload.preferred_username || payload.upn || payload.unique_name || '').toLowerCase().trim();
            const name = payload.name || payload.given_name || (email ? email.split('@')[0] : '');
            
            if (email) {
              if (isMounted) {
                setCheckingAuth(true);
                setStatusMessage(`Authorizing ${email}...`);
              }

              const res = await axios.post('/api/auth/verify-access', { email });
              if (!isMounted) return;

              if (res.data.success && res.data.approved) {
                if (res.data.role === 'admin') {
                  localStorage.setItem('insightHub_adminAuth', 'true');
                } else {
                  localStorage.removeItem('insightHub_adminAuth');
                }
                localStorage.setItem('userRole', res.data.role || 'user');
                localStorage.setItem('userEmail', email);
                localStorage.setItem('userName', name);
                navigate('/dashboard', { replace: true });
                return;
              } else if (res.data.status === 'declined') {
                localStorage.removeItem('userEmail');
                localStorage.removeItem('userName');
                localStorage.removeItem('userRole');
                localStorage.removeItem('insightHub_adminAuth');
                setError('Your access request was declined by the administrator. Please contact your department head.');
                setCheckingAuth(false);
                return;
              } else {
                localStorage.removeItem('insightHub_adminAuth');
                localStorage.setItem('userEmail', email);
                localStorage.setItem('userName', name);
                navigate('/request-access', { replace: true });
                return;
              }
            }
          }
        }

        // 2. Check for Authorization Code in URL (#code=... or ?code=...)
        const authCode = urlParams.get('code');
        if (authCode) {
          if (isMounted) {
            setCheckingAuth(true);
            setStatusMessage('Verifying Microsoft authorization code...');
          }

          try {
            const exchangeRes = await axios.post('/api/auth/ms-code-exchange', {
              code: authCode,
              redirectUri: window.location.origin + '/login'
            });

            if (!isMounted) return;

            if (exchangeRes.data.success) {
              const email = exchangeRes.data.email;
              const name = exchangeRes.data.name;

              if (exchangeRes.data.approved) {
                if (exchangeRes.data.role === 'admin') {
                  localStorage.setItem('insightHub_adminAuth', 'true');
                } else {
                  localStorage.removeItem('insightHub_adminAuth');
                }
                localStorage.setItem('userRole', exchangeRes.data.role || 'user');
                localStorage.setItem('userEmail', email);
                localStorage.setItem('userName', name);
                navigate('/dashboard', { replace: true });
                return;
              } else if (exchangeRes.data.status === 'declined') {
                localStorage.removeItem('userEmail');
                localStorage.removeItem('userName');
                localStorage.removeItem('userRole');
                localStorage.removeItem('insightHub_adminAuth');
                setError('Your access request was declined by the administrator.');
                setCheckingAuth(false);
                return;
              } else {
                localStorage.removeItem('insightHub_adminAuth');
                localStorage.setItem('userEmail', email);
                localStorage.setItem('userName', name);
                navigate('/request-access', { replace: true });
                return;
              }
            }
          } catch (codeErr) {
            console.warn('Code exchange warning:', codeErr);
          }
        }

        // 3. Check existing user session in localStorage
        const existingEmail = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
        if (existingEmail && existingEmail.includes('@')) {
          if (isMounted) {
            setCheckingAuth(true);
            setStatusMessage(`Welcome back, checking access...`);
          }

          const res = await axios.post('/api/auth/verify-access', { email: existingEmail });
          if (!isMounted) return;

          if (res.data.success && res.data.approved) {
            if (res.data.role === 'admin') {
              localStorage.setItem('insightHub_adminAuth', 'true');
            } else {
              localStorage.removeItem('insightHub_adminAuth');
            }
            localStorage.setItem('userRole', res.data.role || 'user');
            navigate('/dashboard', { replace: true });
            return;
          } else if (res.data.status === 'declined') {
            localStorage.removeItem('userEmail');
            localStorage.removeItem('userName');
            localStorage.removeItem('userRole');
            localStorage.removeItem('insightHub_adminAuth');
            setError('Your access request was declined by the administrator.');
            setCheckingAuth(false);
            return;
          } else {
            localStorage.removeItem('insightHub_adminAuth');
            navigate('/request-access', { replace: true });
            return;
          }
        }

        // 4. If no session and no URL parameters, show the clean login screen
        if (isMounted) {
          setCheckingAuth(false);
          setStatusMessage('');
        }
      } catch (err) {
        console.error('Session verification error:', err);
        if (isMounted) {
          setCheckingAuth(false);
          setStatusMessage('');
        }
      }
    };

    processLoginCallbackAndSession();

    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const handleSendOtp = async (e) => {
    e?.preventDefault();
    setError('');
    setOtpSuccessMessage('');
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid SLT or Mobitel work email.');
      return;
    }
    setOtpLoading(true);
    try {
      const res = await axios.post('/api/auth/send-otp', { email: cleanEmail });
      if (res.data.success) {
        setOtpSent(true);
        setOtpSuccessMessage(`Verification code sent to ${cleanEmail}! Please check your inbox.`);
      } else {
        setError(res.data.error || 'Failed to send login code.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send login code. Please ensure your account has been approved by the administrator.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    setError('');
    const cleanOtp = otpInput.trim();
    if (!cleanOtp || cleanOtp.length < 6) {
      setError('Please enter the complete 6-digit verification code.');
      return;
    }
    setOtpLoading(true);
    try {
      const res = await axios.post('/api/auth/verify-otp', {
        email: emailInput.trim().toLowerCase(),
        otp: cleanOtp
      });
      if (res.data.success && res.data.approved) {
        if (res.data.role === 'admin') {
          localStorage.setItem('insightHub_adminAuth', 'true');
        } else {
          localStorage.removeItem('insightHub_adminAuth');
        }
        localStorage.setItem('userRole', res.data.role || 'user');
        localStorage.setItem('userEmail', res.data.user.email);
        localStorage.setItem('userName', res.data.user.name);
        navigate('/dashboard', { replace: true });
      } else {
        setError(res.data.error || 'Invalid or expired verification code.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed. Please check the code and try again.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleMicrosoftLogin = () => {
    setError('');
    setLoading(true);
    setStatusMessage('Redirecting to Microsoft Entra ID...');

    try {
      const clientId = '437e0ec1-9151-438f-9ddb-d86e6e25527d';
      const tenantId = 'organizations';
      const redirectUri = encodeURIComponent(window.location.origin + '/login');
      const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);

      // Request ID Token (and code) directly in fragment so identity is delivered instantly
      const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=id_token%20code&redirect_uri=${redirectUri}&scope=openid%20profile%20email&response_mode=fragment&nonce=${nonce}&prompt=select_account`;
      
      window.location.href = authUrl;
    } catch (err) {
      console.error('Microsoft login redirect error:', err);
      setError(err.message || 'Unable to redirect to Microsoft authentication.');
      setLoading(false);
    }
  };

  const handleDevLogin = async (email = 'dineshpi@slt.com.lk', name = 'Dinesh Shameera (Admin)') => {
    try {
      setLoading(true);
      setStatusMessage(`Authorizing ${email} (Dev Mode)...`);
      try {
        const res = await axios.post('/api/auth/verify-access', { email });
        if (res.data?.success && res.data?.approved) {
          if (res.data.role === 'admin') {
            localStorage.setItem('insightHub_adminAuth', 'true');
          } else {
            localStorage.removeItem('insightHub_adminAuth');
          }
          localStorage.setItem('userRole', res.data.role || 'admin');
          localStorage.setItem('userEmail', email);
          localStorage.setItem('userName', name);
          navigate('/dashboard', { replace: true });
          return;
        }
      } catch (err) {
        console.warn('Backend verify-access warning during dev login:', err);
      }
      localStorage.setItem('insightHub_adminAuth', 'true');
      localStorage.setItem('userRole', 'admin');
      localStorage.setItem('userEmail', email);
      localStorage.setItem('userName', name);
      navigate('/dashboard', { replace: true });
    } finally {
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={38} className="spin" style={{ color: '#0066FF', margin: '0 auto 1rem auto' }} />
          <p style={{ color: '#64748b', fontSize: '0.92rem', fontWeight: 600 }}>{statusMessage || 'Verifying enterprise credentials...'}</p>
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
        className="animate-fade-in auth-card"
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
            Access is restricted to authorized SLT-Mobitel staff using verified <strong>@slt.com.lk</strong> or <strong>@mobitel.lk</strong> Microsoft credentials.
          </p>
        </div>

        {/* Sign-In Method Selector (Work Email OTP vs Microsoft SSO) */}
        <div style={{
          display: 'flex',
          background: '#f1f5f9',
          padding: '4px',
          borderRadius: '0.85rem',
          marginBottom: '1.5rem',
          gap: '4px'
        }}>
          <button
            type="button"
            onClick={() => { setAuthMode('email'); setError(''); }}
            style={{
              flex: 1,
              padding: '0.65rem 0.5rem',
              borderRadius: '0.65rem',
              border: 'none',
              background: authMode === 'email' ? '#ffffff' : 'transparent',
              color: authMode === 'email' ? '#0066FF' : '#64748b',
              fontWeight: 700,
              fontSize: '0.86rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              boxShadow: authMode === 'email' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Mail size={16} /> Work Email Sign-In
          </button>
          <button
            type="button"
            onClick={() => { setAuthMode('ms'); setError(''); }}
            style={{
              flex: 1,
              padding: '0.65rem 0.5rem',
              borderRadius: '0.65rem',
              border: 'none',
              background: authMode === 'ms' ? '#ffffff' : 'transparent',
              color: authMode === 'ms' ? '#0066FF' : '#64748b',
              fontWeight: 700,
              fontSize: '0.86rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              boxShadow: authMode === 'ms' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Lock size={15} /> Microsoft 365 (SSO)
          </button>
        </div>

        {authMode === 'email' ? (
          <div style={{ marginBottom: '1.5rem' }}>
            {!otpSent ? (
              <form onSubmit={handleSendOtp} style={{ textAlign: 'left' }}>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>
                  Official Work Email (@slt.com.lk or @mobitel.lk)
                </label>
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                  <Mail size={18} style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="user@slt.com.lk or user@mobitel.lk"
                    required
                    style={{
                      width: '100%',
                      padding: '0.85rem 1rem 0.85rem 2.5rem',
                      fontSize: '0.92rem',
                      border: '1.5px solid #cbd5e1',
                      borderRadius: '0.75rem',
                      outline: 'none',
                      transition: 'border-color 0.2s',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={otpLoading}
                  style={{
                    width: '100%',
                    padding: '0.85rem 1.25rem',
                    fontSize: '0.92rem',
                    fontWeight: 700,
                    color: '#ffffff',
                    background: '#0066FF',
                    border: 'none',
                    borderRadius: '0.75rem',
                    cursor: otpLoading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 14px rgba(0, 102, 255, 0.25)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {otpLoading ? <Loader2 size={18} className="spin" /> : <><span>Send 6-Digit Login Code</span> <ArrowRight size={16} /></>}
                </button>
                <p style={{ fontSize: '0.78rem', color: '#64748b', textAlign: 'center', margin: '0.75rem 0 0 0' }}>
                  Instant login for approved SLT & Mobitel staff members.
                </p>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} style={{ textAlign: 'left' }}>
                <div style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  color: '#166534',
                  borderRadius: '0.75rem',
                  padding: '0.75rem 0.9rem',
                  fontSize: '0.82rem',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <CheckCircle size={16} style={{ flexShrink: 0 }} />
                  <span>Code sent to <strong>{emailInput}</strong></span>
                </div>

                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>
                  Enter 6-Digit Code
                </label>
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                  <KeyRound size={18} style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    maxLength={6}
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    autoFocus
                    required
                    style={{
                      width: '100%',
                      padding: '0.85rem 1rem 0.85rem 2.5rem',
                      fontSize: '1.35rem',
                      fontWeight: 800,
                      letterSpacing: '6px',
                      border: '2px solid #0066FF',
                      borderRadius: '0.75rem',
                      outline: 'none',
                      background: '#f0f7ff',
                      color: '#0066FF',
                      boxSizing: 'border-box',
                      textAlign: 'center'
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={otpLoading}
                  style={{
                    width: '100%',
                    padding: '0.85rem 1.25rem',
                    fontSize: '0.92rem',
                    fontWeight: 700,
                    color: '#ffffff',
                    background: '#10b981',
                    border: 'none',
                    borderRadius: '0.75rem',
                    cursor: otpLoading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {otpLoading ? <Loader2 size={18} className="spin" /> : <><span>Verify Code & Sign In</span> <ArrowRight size={16} /></>}
                </button>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', fontSize: '0.8rem' }}>
                  <button
                    type="button"
                    onClick={() => { setOtpSent(false); setOtpInput(''); setError(''); }}
                    style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    ← Change Email
                  </button>
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={otpLoading}
                    style={{ background: 'none', border: 'none', color: '#0066FF', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Resend Code
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div>
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
          </div>
        )}

        {/* Localhost Development Bypass - only visible on local dev */}
        {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
          <div style={{
            marginTop: '1.25rem',
            padding: '1.1rem',
            background: '#f8fafc',
            border: '1.5px dashed #cbd5e1',
            borderRadius: '0.85rem',
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                🛠️ Localhost Developer Quick Sign-In
              </span>
              <span style={{ fontSize: '0.7rem', background: '#e2e8f0', color: '#475569', padding: '2px 7px', borderRadius: '4px', fontWeight: 700 }}>
                Dev Mode
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 0.85rem 0', lineHeight: 1.45 }}>
              Azure Entra ID does not have <code>http://localhost:5173/login</code> in its Redirect URIs. Use this button to log in instantly with the approved Administrator profile.
            </p>
            <button
              type="button"
              onClick={() => handleDevLogin('dineshpi@slt.com.lk', 'Dinesh Shameera (Admin)')}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                fontSize: '0.86rem',
                fontWeight: 700,
                color: '#0369a1',
                background: '#e0f2fe',
                border: '1.5px solid #7dd3fc',
                borderRadius: '0.65rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                transition: 'all 0.15s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#bae6fd';
                e.currentTarget.style.borderColor = '#38bdf8';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = '#e0f2fe';
                e.currentTarget.style.borderColor = '#7dd3fc';
              }}
            >
              <ShieldCheck size={16} /> Sign In as Dinesh Shameera (Admin)
            </button>
          </div>
        )}

        {/* Footer Info */}
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
          <span>Enterprise Access Control</span>
        </div>
      </div>
    </div>
  );
};

export default Login;

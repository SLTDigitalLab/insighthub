import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Lock, CheckCircle, AlertCircle, Loader2, KeyRound } from 'lucide-react';
import axios from 'axios';

const SetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [userInfo, setUserInfo] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('No activation token provided. Please use the link sent to your email.');
      setVerifying(false);
      return;
    }

    const verifyToken = async () => {
      try {
        const res = await axios.get(`/api/auth/verify-token/${token}`);
        if (res.data.success) {
          setUserInfo(res.data.user);
        } else {
          setError(res.data.error || 'Invalid or expired activation link.');
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Invalid or expired activation link.');
      } finally {
        setVerifying(false);
      }
    };

    verifyToken();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);

    try {
      const res = await axios.post('/api/auth/set-password', {
        token: token,
        password: password
      });

      if (res.data.success) {
        setSuccess(true);
        if (res.data.user && res.data.user.email) {
          localStorage.setItem('userEmail', res.data.user.email);
        }
        setTimeout(() => {
          navigate('/dashboard');
        }, 2000);
      } else {
        setError(res.data.error || 'Failed to create password.');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to set password.');
    } finally {
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <Loader2 size={40} className="spin" style={{ color: '#0066FF' }} />
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
      padding: '2rem'
    }}>
      <div style={{
        background: '#ffffff',
        padding: '3.5rem 2.5rem',
        borderRadius: '1.25rem',
        boxShadow: '0 20px 45px -10px rgba(0, 102, 255, 0.12), 0 0 1px 1px rgba(0, 0, 0, 0.05)',
        width: '100%',
        maxWidth: '460px',
        border: '1px solid #e2e8f0',
        textAlign: 'center'
      }}>
        {/* Logo */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.6rem 1.2rem',
          borderRadius: '1rem',
          background: '#ffffff',
          border: '1px solid #f1f5f9',
          boxShadow: '0 8px 25px rgba(0, 102, 255, 0.08)',
          marginBottom: '1.25rem'
        }}>
          <img
            src="/insighthub-logo.png"
            alt="InsightHub Logo"
            style={{ maxHeight: '75px', maxWidth: '190px', width: 'auto', objectFit: 'contain' }}
          />
        </div>

        {success ? (
          <div>
            <div style={{
              width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)',
              color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
            }}>
              <CheckCircle size={32} />
            </div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
              Account Activated!
            </h2>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Your password has been set. Redirecting you to InsightHub dashboard...
            </p>
            <Loader2 size={24} className="spin" style={{ color: '#0066FF', margin: '0 auto' }} />
          </div>
        ) : error ? (
          <div>
            <div style={{
              width: '56px', height: '56px', borderRadius: '50%', background: '#fee2e2',
              color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
            }}>
              <AlertCircle size={32} />
            </div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
              Activation Link Error
            </h2>
            <p style={{ color: '#ef4444', fontSize: '0.9rem', marginBottom: '1.75rem', lineHeight: 1.5 }}>
              {error}
            </p>
            <Link
              to="/login"
              style={{
                display: 'inline-block',
                padding: '0.75rem 1.5rem',
                borderRadius: '0.75rem',
                background: '#0066FF',
                color: '#ffffff',
                fontWeight: 700,
                textDecoration: 'none',
                fontSize: '0.9rem'
              }}
            >
              Go to Login Page
            </Link>
          </div>
        ) : (
          <div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.35rem' }}>
              Create Your Login Password
            </h2>
            <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: '1.75rem' }}>
              Welcome <strong>{userInfo?.name}</strong> ({userInfo?.email}). Please set a secure password for your account.
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                  New Password *
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem 0.75rem 2.75rem',
                      borderRadius: '0.75rem',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.92rem',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                  Confirm Password *
                </label>
                <div style={{ position: 'relative' }}>
                  <KeyRound size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem 0.75rem 2.75rem',
                      borderRadius: '0.75rem',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.92rem',
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
                  padding: '0.9rem',
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
                  marginTop: '0.5rem'
                }}
              >
                {loading ? <Loader2 size={18} className="spin" /> : 'Set Password & Activate Access'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default SetPassword;

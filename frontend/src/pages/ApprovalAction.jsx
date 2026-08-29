import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle, XCircle, AlertCircle, Loader2, ShieldCheck, ArrowRight } from 'lucide-react';
import axios from 'axios';

const ApprovalAction = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const action = searchParams.get('action');
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!action || !token) {
      setError('Invalid or missing action parameters.');
      setLoading(false);
      return;
    }

    const processAction = async () => {
      try {
        const res = await axios.get(`/api/auth/action/${action}/${token}`);
        if (res.data.success) {
          setResult(res.data);
        } else {
          setError(res.data.error || 'Action failed.');
        }
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'An error occurred while processing this action.');
      } finally {
        setLoading(false);
      }
    };

    processAction();
  }, [action, token]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={40} className="spin" style={{ color: '#0066FF', margin: '0 auto 1rem auto' }} />
          <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Processing administrator action...</p>
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
      padding: '2rem'
    }}>
      <div style={{
        background: '#ffffff',
        padding: '3.5rem 2.5rem',
        borderRadius: '1.25rem',
        boxShadow: '0 20px 45px -10px rgba(0, 102, 255, 0.12), 0 0 1px 1px rgba(0, 0, 0, 0.05)',
        width: '100%',
        maxWidth: '500px',
        border: '1px solid #e2e8f0',
        textAlign: 'center'
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.6rem 1.2rem',
          borderRadius: '1rem',
          background: '#ffffff',
          border: '1px solid #f1f5f9',
          boxShadow: '0 8px 25px rgba(0, 102, 255, 0.08)',
          marginBottom: '1.5rem'
        }}>
          <img
            src="/insighthub-logo.png"
            alt="InsightHub Logo"
            style={{ maxHeight: '75px', maxWidth: '190px', width: 'auto', objectFit: 'contain' }}
          />
        </div>

        {error ? (
          <div>
            <div style={{
              width: '60px', height: '60px', borderRadius: '50%', background: '#fee2e2',
              color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
            }}>
              <AlertCircle size={36} />
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
              Action Unsuccessful
            </h2>
            <p style={{ color: '#ef4444', fontSize: '0.92rem', marginBottom: '2rem', lineHeight: 1.5 }}>
              {error}
            </p>
            <Link
              to="/admin"
              style={{
                display: 'inline-block',
                padding: '0.8rem 1.75rem',
                borderRadius: '0.75rem',
                background: '#0066FF',
                color: '#ffffff',
                fontWeight: 700,
                textDecoration: 'none',
                fontSize: '0.92rem'
              }}
            >
              Open Admin Portal
            </Link>
          </div>
        ) : action === 'approve' ? (
          <div>
            <div style={{
              width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)',
              color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
            }}>
              <CheckCircle size={36} />
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
              Registration Approved!
            </h2>
            <p style={{ color: '#475569', fontSize: '0.92rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              {result?.message}
            </p>
            <div style={{
              background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.75rem',
              padding: '1rem', textAlign: 'left', fontSize: '0.88rem', color: '#334155', marginBottom: '2rem'
            }}>
              <p style={{ margin: '0 0 0.4rem 0' }}><strong>User:</strong> {result?.user?.name}</p>
              <p style={{ margin: '0 0 0.4rem 0' }}><strong>Email:</strong> {result?.user?.email}</p>
              <p style={{ margin: 0, color: '#10b981', fontWeight: 700 }}>Status: Approved & Activation Email Sent</p>
            </div>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <Link
                to="/admin"
                style={{
                  flex: 1, padding: '0.85rem', borderRadius: '0.75rem', border: '1px solid #cbd5e1',
                  background: '#ffffff', color: '#0f172a', fontWeight: 700, textDecoration: 'none', fontSize: '0.9rem'
                }}
              >
                Admin Portal
              </Link>
              <Link
                to="/login"
                style={{
                  flex: 1, padding: '0.85rem', borderRadius: '0.75rem', border: 'none',
                  background: '#0066FF', color: '#ffffff', fontWeight: 700, textDecoration: 'none', fontSize: '0.9rem'
                }}
              >
                Sign In
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <div style={{
              width: '60px', height: '60px', borderRadius: '50%', background: '#fee2e2',
              color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
            }}>
              <XCircle size={36} />
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
              Registration Declined
            </h2>
            <p style={{ color: '#475569', fontSize: '0.92rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              {result?.message}
            </p>
            <Link
              to="/admin"
              style={{
                display: 'inline-block', padding: '0.8rem 1.75rem', borderRadius: '0.75rem',
                background: '#0066FF', color: '#ffffff', fontWeight: 700, textDecoration: 'none', fontSize: '0.92rem'
              }}
            >
              Open Admin Portal
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApprovalAction;

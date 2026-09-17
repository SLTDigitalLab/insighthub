import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  ShieldCheck, 
  UserCheck, 
  UserX, 
  Building2, 
  Mail, 
  Phone, 
  BadgeCheck, 
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import axios from 'axios';

const ApprovalAction = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const initialAction = searchParams.get('action');
  const token = searchParams.get('token');

  const [action, setAction] = useState(initialAction);
  const [loading, setLoading] = useState(true);
  const [previewUser, setPreviewUser] = useState(null);
  const [alreadyHandled, setAlreadyHandled] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // 1. Safe Read-Only Preview on Mount (Safe from automated crawlers/scanners)
  useEffect(() => {
    if (!token || !initialAction) {
      setError('Invalid or missing action parameters.');
      setLoading(false);
      return;
    }

    const fetchPreview = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await axios.get(`/api/auth/action-preview/${initialAction}/${token}`);
        if (res.data.success) {
          setPreviewUser(res.data.user);
          setAlreadyHandled(res.data.alreadyHandled);
          setAction(res.data.action);
        } else {
          setError(res.data.error || 'Failed to load request preview.');
        }
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'An error occurred while loading this access request.');
      } finally {
        setLoading(false);
      }
    };

    fetchPreview();
  }, [initialAction, token]);

  // 2. Explicit User-Triggered Action (POST Request)
  const handleExecute = async (overrideAction) => {
    const targetAction = overrideAction || action;
    try {
      setExecuting(true);
      setError('');
      const res = await axios.post('/api/auth/action-execute', {
        action: targetAction,
        token: token,
        reason: targetAction === 'decline' ? declineReason : undefined
      });

      if (res.data.success) {
        setResult(res.data);
      } else {
        setError(res.data.error || 'Action failed.');
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'An error occurred while executing this action.');
    } finally {
      setExecuting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={40} className="spin" style={{ color: '#0066FF', margin: '0 auto 1rem auto' }} />
          <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Loading access request details...</p>
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
      padding: '2rem 1rem'
    }}>
      <div style={{
        background: '#ffffff',
        padding: '3rem 2.25rem',
        borderRadius: '1.25rem',
        boxShadow: '0 20px 45px -10px rgba(0, 102, 255, 0.12), 0 0 1px 1px rgba(0, 0, 0, 0.05)',
        width: '100%',
        maxWidth: '560px',
        border: '1px solid #e2e8f0',
        textAlign: 'center'
      }}>
        {/* Header Logo */}
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
            style={{ maxHeight: '70px', maxWidth: '180px', width: 'auto', objectFit: 'contain' }}
          />
        </div>

        {/* 1. Error View */}
        {error && !previewUser && (
          <div>
            <div style={{
              width: '60px', height: '60px', borderRadius: '50%', background: '#fee2e2',
              color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
            }}>
              <AlertCircle size={36} />
            </div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
              Link Inactive or Invalid
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
        )}

        {/* 2. Success Result View (After Explicit POST Execution) */}
        {result ? (
          <div>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: result.action === 'approved' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              color: result.action === 'approved' ? '#10b981' : '#ef4444',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
            }}>
              {result.action === 'approved' ? <CheckCircle size={38} /> : <XCircle size={38} />}
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
              {result.action === 'approved' ? 'Access Request Approved!' : 'Access Request Declined'}
            </h2>
            <p style={{ color: '#475569', fontSize: '0.92rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              {result.message}
            </p>
            <div style={{
              background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.75rem',
              padding: '1.25rem', textAlign: 'left', fontSize: '0.88rem', color: '#334155', marginBottom: '2rem'
            }}>
              <p style={{ margin: '0 0 0.5rem 0' }}><strong>User:</strong> {result?.user?.name}</p>
              <p style={{ margin: '0 0 0.5rem 0' }}><strong>Email:</strong> {result?.user?.email}</p>
              <p style={{ margin: 0, color: result.action === 'approved' ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                Status: {result.action === 'approved' ? 'Active / Authorized' : 'Declined'}
              </p>
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
        ) : previewUser && alreadyHandled ? (
          /* 3. Already Handled View (Previously Approved or Declined) */
          <div>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: previewUser.status === 'approved' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: previewUser.status === 'approved' ? '#10b981' : '#ef4444',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
            }}>
              {previewUser.status === 'approved' ? <ShieldCheck size={38} /> : <ShieldAlert size={38} />}
            </div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.4rem' }}>
              Request Already Handled
            </h2>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              This access request has already been processed by an administrator.
            </p>

            <div style={{
              background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.75rem',
              padding: '1.25rem', textAlign: 'left', fontSize: '0.88rem', color: '#334155', marginBottom: '2rem'
            }}>
              <p style={{ margin: '0 0 0.4rem 0' }}><strong>Full Name:</strong> {previewUser.name}</p>
              <p style={{ margin: '0 0 0.4rem 0' }}><strong>Email:</strong> {previewUser.email}</p>
              <p style={{ margin: '0 0 0.4rem 0' }}><strong>Role / Section:</strong> {previewUser.section} {previewUser.subSection ? `(${previewUser.subSection})` : ''} - {previewUser.designation}</p>
              <p style={{ margin: '0 0 0.4rem 0' }}><strong>Processed Status:</strong> <span style={{ color: previewUser.status === 'approved' ? '#10b981' : '#ef4444', fontWeight: 700 }}>{previewUser.status.toUpperCase()}</span></p>
              {previewUser.handledBy && (
                <p style={{ margin: '0 0 0.4rem 0', color: '#64748b', fontSize: '0.82rem' }}>
                  Handled by: {previewUser.handledBy} {previewUser.handledAt ? `on ${new Date(previewUser.handledAt).toLocaleDateString()}` : ''}
                </p>
              )}
            </div>

            <Link
              to="/admin"
              style={{
                display: 'inline-block',
                padding: '0.85rem 2rem',
                borderRadius: '0.75rem',
                background: '#0066FF',
                color: '#ffffff',
                fontWeight: 700,
                textDecoration: 'none',
                fontSize: '0.92rem'
              }}
            >
              Open Admin Portal →
            </Link>
          </div>
        ) : previewUser && !alreadyHandled ? (
          /* 4. Active Review & Confirmation View (Requires Explicit Human Click) */
          <div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.4rem 0.9rem',
              borderRadius: '2rem',
              background: action === 'approve' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: action === 'approve' ? '#059669' : '#dc2626',
              fontSize: '0.82rem',
              fontWeight: 700,
              marginBottom: '1rem'
            }}>
              {action === 'approve' ? <UserCheck size={16} /> : <UserX size={16} />}
              Administrator Review Required
            </div>

            <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.4rem' }}>
              {action === 'approve' ? 'Confirm Access Grant' : 'Confirm Access Decline'}
            </h2>
            <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
              Please review the user details below before confirming this action.
            </p>

            {/* User Profile Card */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '0.75rem',
              padding: '1.25rem',
              textAlign: 'left',
              fontSize: '0.88rem',
              color: '#334155',
              marginBottom: '1.5rem'
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '0.5rem', alignItems: 'baseline' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Full Name:</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>{previewUser.name}</span>

                <span style={{ color: '#64748b', fontWeight: 600 }}>Work Email:</span>
                <span style={{ color: '#0066FF', fontWeight: 600 }}>{previewUser.email}</span>

                <span style={{ color: '#64748b', fontWeight: 600 }}>Section:</span>
                <span>{previewUser.section} {previewUser.subSection ? `(${previewUser.subSection})` : ''}</span>

                <span style={{ color: '#64748b', fontWeight: 600 }}>Designation:</span>
                <span>{previewUser.designation}</span>

                {previewUser.serviceNumber && (
                  <>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Service No:</span>
                    <span>{previewUser.serviceNumber}</span>
                  </>
                )}

                {previewUser.mobileNumber && (
                  <>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Mobile No:</span>
                    <span>{previewUser.mobileNumber}</span>
                  </>
                )}

                {previewUser.note && (
                  <>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>User Note:</span>
                    <span style={{ color: '#475569', fontStyle: 'italic' }}>"{previewUser.note}"</span>
                  </>
                )}
              </div>
            </div>

            {/* Decline Reason Input (Only shown for decline) */}
            {action === 'decline' && (
              <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                  Decline Reason (Optional)
                </label>
                <textarea
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="e.g. Account manager assignment needs departmental verification..."
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '0.5rem',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
            )}

            {error && (
              <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {error}
              </p>
            )}

            {/* Confirmation Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {action === 'approve' ? (
                <>
                  <button
                    onClick={() => handleExecute('approve')}
                    disabled={executing}
                    style={{
                      width: '100%',
                      padding: '0.9rem',
                      borderRadius: '0.75rem',
                      border: 'none',
                      background: '#10b981',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      cursor: executing ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                      opacity: executing ? 0.7 : 1
                    }}
                  >
                    {executing ? (
                      <>
                        <Loader2 size={18} className="spin" />
                        Granting Access...
                      </>
                    ) : (
                      <>
                        <CheckCircle size={18} />
                        ✓ Confirm & Grant Access
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setAction('decline')}
                    disabled={executing}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '0.4rem'
                    }}
                  >
                    Switch to Decline Request
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleExecute('decline')}
                    disabled={executing}
                    style={{
                      width: '100%',
                      padding: '0.9rem',
                      borderRadius: '0.75rem',
                      border: 'none',
                      background: '#ef4444',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      cursor: executing ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 4px 14px rgba(239, 68, 68, 0.35)',
                      opacity: executing ? 0.7 : 1
                    }}
                  >
                    {executing ? (
                      <>
                        <Loader2 size={18} className="spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <XCircle size={18} />
                        ✕ Confirm Decline
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setAction('approve')}
                    disabled={executing}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#10b981',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: '0.4rem'
                    }}
                  >
                    Switch to Approve Request
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ApprovalAction;


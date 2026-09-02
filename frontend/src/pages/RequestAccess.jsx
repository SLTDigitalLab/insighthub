import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, Mail, User, Building, Briefcase, FileText, ArrowRight, CheckCircle, Clock, AlertCircle, Loader2, LogOut } from 'lucide-react';
import axios from 'axios';

const RequestAccess = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('Enterprise Sales & Solutions');
  const [designation, setDesignation] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pendingStatus, setPendingStatus] = useState(false);

  useEffect(() => {
    const storedEmail = localStorage.getItem('userEmail') || '';
    const storedName = localStorage.getItem('userName') || '';

    if (!storedEmail) {
      navigate('/login');
      return;
    }

    setEmail(storedEmail);
    setName(storedName || storedEmail.split('@')[0]);

    // Check if already approved or pending
    checkCurrentStatus(storedEmail);
  }, []);

  const checkCurrentStatus = async (userEmail) => {
    try {
      const res = await axios.post('/api/auth/verify-access', { email: userEmail });
      if (res.data.success && res.data.approved) {
        navigate('/dashboard');
      } else if (res.data.status === 'pending_approval') {
        setPendingStatus(true);
      }
    } catch (err) {
      console.warn('Status check warning:', err);
    }
  };

  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    setError('');

    if (!email) {
      setError('Please sign in with your Microsoft Work Account first.');
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post('/api/auth/request-access', {
        name: name.trim(),
        email: email.trim(),
        department: department.trim(),
        designation: designation.trim() || 'Enterprise Account Executive',
        note: note.trim()
      });

      if (res.data.success) {
        if (res.data.alreadyApproved) {
          navigate('/dashboard');
        } else {
          setSubmitted(true);
        }
      } else {
        setError(res.data.error || 'Failed to submit access request.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'An error occurred while submitting your access request.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    localStorage.removeItem('msalUser');
    navigate('/login');
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
          maxWidth: '520px',
          border: '1px solid #e2e8f0',
          textAlign: 'center'
        }}
      >
        {/* Header Branding */}
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
              style={{ maxHeight: '80px', maxWidth: '210px', width: 'auto', objectFit: 'contain' }}
            />
          </div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', marginTop: '0.25rem' }}>
            Request Platform Access
          </h2>
          <p style={{ color: '#64748b', marginTop: '0.25rem', fontSize: '0.84rem', fontWeight: 500 }}>
            SLT-Mobitel Enterprise Sales Intelligence
          </p>
        </div>

        {/* Microsoft Identity Badge */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(0, 102, 255, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)',
          border: '1px solid #bfdbfe',
          borderRadius: '0.85rem',
          padding: '0.85rem 1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          textAlign: 'left'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Microsoft 4-square icon */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', width: '18px', height: '18px', flexShrink: 0 }}>
              <div style={{ background: '#f25022', borderRadius: '1px' }}></div>
              <div style={{ background: '#7fba00', borderRadius: '1px' }}></div>
              <div style={{ background: '#00a4ef', borderRadius: '1px' }}></div>
              <div style={{ background: '#ffb900', borderRadius: '1px' }}></div>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>{name || 'Microsoft User'}</p>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#0066FF', fontWeight: 600 }}>{email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out of this Microsoft account"
            style={{
              background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.35rem',
              display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 600
            }}
          >
            <LogOut size={14} /> Switch
          </button>
        </div>

        {submitted || pendingStatus ? (
          <div className="animate-fade-in" style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(0, 102, 255, 0.1)',
              color: '#0066FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
            }}>
              <Clock size={36} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.5rem' }}>
              Access Request Pending Approval
            </h3>
            <p style={{ color: '#475569', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '1.75rem' }}>
              Your access request for <strong>{email}</strong> has been transmitted to the system administrator. You will receive an automated email notification as soon as your access is approved.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => checkCurrentStatus(email)}
                style={{
                  flex: 1, padding: '0.8rem', borderRadius: '0.75rem', background: '#0066FF', color: '#ffffff',
                  fontWeight: 700, border: 'none', cursor: 'pointer', fontSize: '0.88rem'
                }}
              >
                Check Approval Status
              </button>
              <button
                onClick={handleLogout}
                style={{
                  padding: '0.8rem 1.25rem', borderRadius: '0.75rem', background: '#f1f5f9', color: '#475569',
                  fontWeight: 600, border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '0.88rem'
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitRequest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
            {error && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
                borderRadius: '0.75rem', padding: '0.75rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem'
              }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                Full Name
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Enter your full name"
                  style={{
                    width: '100%', padding: '0.75rem 1rem 0.75rem 2.5rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.75rem', outline: 'none'
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                Department / Division
              </label>
              <div style={{ position: 'relative' }}>
                <Building size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  style={{
                    width: '100%', padding: '0.75rem 1rem 0.75rem 2.5rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.75rem', outline: 'none', background: '#ffffff'
                  }}
                >
                  <option value="Enterprise Sales & Solutions">Enterprise Sales & Solutions</option>
                  <option value="SME Business Development">SME Business Development</option>
                  <option value="Corporate & Strategic Accounts">Corporate & Strategic Accounts</option>
                  <option value="Product Marketing & Strategy">Product Marketing & Strategy</option>
                  <option value="Network & Cloud Infrastructure">Network & Cloud Infrastructure</option>
                  <option value="Digital Labs / R&D">Digital Labs / R&D</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                Designation / Job Role
              </label>
              <div style={{ position: 'relative' }}>
                <Briefcase size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="e.g. Account Manager / Sales Specialist"
                  style={{
                    width: '100%', padding: '0.75rem 1rem 0.75rem 2.5rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.75rem', outline: 'none'
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                Business Justification (Optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Briefly state your sales region or intended use case..."
                style={{
                  width: '100%', padding: '0.65rem 0.85rem', fontSize: '0.85rem',
                  border: '1px solid #cbd5e1', borderRadius: '0.75rem', outline: 'none', resize: 'none'
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.85rem',
                fontSize: '0.92rem',
                fontWeight: 700,
                color: '#ffffff',
                background: 'linear-gradient(135deg, #0066FF 0%, #0052cc 100%)',
                border: 'none',
                borderRadius: '0.75rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                marginTop: '0.5rem',
                boxShadow: '0 4px 15px rgba(0, 102, 255, 0.3)'
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Submitting Request...
                </>
              ) : (
                <>
                  Request Access from Administrator
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default RequestAccess;

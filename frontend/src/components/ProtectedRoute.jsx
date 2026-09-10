import React, { useState, useEffect } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';
import axios from 'axios';

const ProtectedRoute = ({ children, requireAdmin = false }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const [verifying, setVerifying] = useState(true);
  const [isAllowed, setIsAllowed] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkAccess = async () => {
      const storedEmail = (localStorage.getItem('userEmail') || '').toLowerCase().trim();

      if (!storedEmail || !storedEmail.includes('@')) {
        // Not signed in
        if (isMounted) {
          setIsAllowed(false);
          setVerifying(false);
          navigate('/login', { replace: true, state: { from: location.pathname } });
        }
        return;
      }

      try {
        const res = await axios.post('/api/auth/verify-access', { email: storedEmail });

        if (!isMounted) return;

        if (res.data && res.data.success) {
          const { approved, status, role } = res.data;

          if (status === 'declined') {
            // User was declined
            localStorage.removeItem('userEmail');
            localStorage.removeItem('userName');
            localStorage.removeItem('userRole');
            localStorage.removeItem('insightHub_adminAuth');
            navigate('/login', {
              replace: true,
              state: { error: 'Your access request was declined by the administrator. Please contact your department head.' }
            });
            return;
          }

          if (!approved || status === 'pending_approval' || status === 'not_found') {
            // Pending or unapproved
            localStorage.removeItem('insightHub_adminAuth');
            navigate('/request-access', { replace: true });
            return;
          }

          // User is approved! Check admin requirement if needed
          if (requireAdmin) {
            if (role !== 'admin') {
              console.warn('[Security Guard] Non-admin attempted to access protected admin area:', storedEmail);
              localStorage.removeItem('insightHub_adminAuth');
              navigate('/dashboard', { replace: true });
              return;
            }
            localStorage.setItem('insightHub_adminAuth', 'true');
          }

          localStorage.setItem('userRole', role || 'user');
          setIsAllowed(true);
        } else {
          // Verification failed
          navigate('/login', { replace: true });
        }
      } catch (err) {
        console.error('[ProtectedRoute Error]', err);
        // On network error or server check error, fail safe to login
        navigate('/login', { replace: true });
      } finally {
        if (isMounted) {
          setVerifying(false);
        }
      }
    };

    checkAccess();

    return () => {
      isMounted = false;
    };
  }, [location.pathname, requireAdmin, navigate]);

  if (verifying) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        fontFamily: 'Inter, -apple-system, sans-serif'
      }}>
        <div style={{
          background: '#ffffff',
          padding: '2.5rem 3rem',
          borderRadius: '1.25rem',
          boxShadow: '0 20px 40px rgba(0, 102, 255, 0.08), 0 1px 3px rgba(0,0,0,0.05)',
          border: '1px solid #e2e8f0',
          textAlign: 'center',
          maxWidth: '400px',
          width: '90%'
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(0, 102, 255, 0.1) 0%, rgba(16, 185, 129, 0.1) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.25rem auto'
          }}>
            <Loader2 size={28} color="#0066FF" className="animate-spin" />
          </div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.5rem 0' }}>
            Verifying Access Permissions
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
            Connecting to SLT-Mobitel Enterprise Access Control...
          </p>
        </div>
      </div>
    );
  }

  return isAllowed ? children : null;
};

export default ProtectedRoute;

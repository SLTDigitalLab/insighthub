import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck, Users, CheckCircle, XCircle, Clock, Search,
  Eye, RefreshCw, LogOut, ArrowLeft, Loader2, AlertCircle,
  FileText, ExternalLink, X, Check, UserPlus, Mail, Building, Briefcase, Trash2
} from 'lucide-react';
import axios from 'axios';

export const ENTERPRISE_SECTIONS = [
  'Enterprise Large',
  'Enterprise Medium',
  'Government',
  'Carrier business',
  'REBM'
];

export const REBM_SUB_SECTIONS = [
  'CPN', 'CPS', 'EP', 'NCP', 'NP', 'NWPE', 'NWPW', 'SAB', 'SPE', 'SPW',
  'UVA', 'WPC1', 'WPC2', 'WPE', 'WPN', 'WPNE', 'WPS', 'WPSE', 'WPSW'
];

export const REBM_AREAS = REBM_SUB_SECTIONS;

export const DESIGNATIONS = [
  'Account Manager',
  'Section Manager'
];

const AdminPortal = () => {
  const navigate = useNavigate();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('invite'); // 'invite' | 'pending' | 'approved' | 'declined' | 'all'
  const [searchTerm, setSearchTerm] = useState('');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [subSectionFilter, setSubSectionFilter] = useState('all');
  const [designationFilter, setDesignationFilter] = useState('all');

  // Structured Invite User Form State (5 Enterprise Sections & 19 REBM Sub-Sections)
  const [inviteSection, setInviteSection] = useState('Enterprise Large');
  const [inviteSubSection, setInviteSubSection] = useState('WPC1');
  const [inviteDesignation, setInviteDesignation] = useState('Account Manager');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteServiceNumber, setInviteServiceNumber] = useState('');
  const [inviteMobileNumber, setInviteMobileNumber] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviteLoading, setInviteLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const checkAdminPermission = async () => {
      const storedEmail = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
      const adminList = [
        'dineshpi@slt.com.lk',
        '020601@intranet.slt.com.lk',
        'lahirus@slt.com.lk',
        'shalikahathurusinghe3584@gmail.com'
      ];

      if (!storedEmail) {
        setIsAuthenticated(false);
        navigate('/login', { replace: true });
        return;
      }

      const cachedRole = localStorage.getItem('userRole');
      const isCandidate = adminList.includes(storedEmail) || cachedRole === 'admin';

      if (!isCandidate) {
        console.warn('[Admin Security] Non-admin access attempt prevented:', storedEmail);
        localStorage.removeItem('insightHub_adminAuth');
        navigate('/dashboard', { replace: true });
        return;
      }

      try {
        const verifyRes = await axios.post('/api/auth/verify-access', { email: storedEmail });
        if (verifyRes.data?.success && verifyRes.data?.approved && verifyRes.data?.role === 'admin') {
          setIsAuthenticated(true);
          localStorage.setItem('insightHub_adminAuth', 'true');
          fetchUsers(storedEmail);
        } else {
          localStorage.removeItem('insightHub_adminAuth');
          navigate('/dashboard', { replace: true });
        }
      } catch (err) {
        console.error('Admin permission verification error:', err);
        navigate('/dashboard', { replace: true });
      }
    };

    checkAdminPermission();
  }, [navigate]);

  const fetchUsers = async (adminEmailOverride) => {
    setLoading(true);
    try {
      const email = (adminEmailOverride || localStorage.getItem('userEmail') || '').toLowerCase().trim();
      const res = await axios.get(`/api/admin/users?requesterEmail=${encodeURIComponent(email)}`, {
        headers: { 'x-user-email': email }
      });
      if (res.data.success) {
        setUsers(res.data.users || []);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
      showToast('Failed to load users list.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const cleanEmail = adminEmail.trim().toLowerCase();
      // Master admin check
      if (
        (cleanEmail === 'dineshpi@slt.com.lk' && adminPassword === 'Admin@Mobitel2026!') ||
        (cleanEmail === '020601@intranet.slt.com.lk' && adminPassword === 'Admin@Mobitel2026!') ||
        (cleanEmail === 'lahirus@slt.com.lk' && adminPassword === 'Admin@Mobitel2026!') ||
        (cleanEmail === 'shalikahathurusinghe3584@gmail.com' && adminPassword === 'Admin@Mobitel2026!') ||
        (cleanEmail.includes('admin') && adminPassword === 'Admin@Mobitel2026!')
      ) {
        setIsAuthenticated(true);
        localStorage.setItem('insightHub_adminAuth', 'true');
        localStorage.setItem('userEmail', cleanEmail);
        localStorage.setItem('userRole', 'admin');
        fetchUsers(cleanEmail);
        return;
      }

      setLoginError('Invalid administrator credentials.');
    } catch (err) {
      setLoginError(err.response?.data?.error || 'Invalid administrator credentials.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleAdminLogout = () => {
    localStorage.removeItem('insightHub_adminAuth');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    localStorage.removeItem('userRole');
    localStorage.removeItem('msalUser');
    setIsAuthenticated(false);
    navigate('/login');
  };

  const handleInviteUser = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      showToast('Please provide a valid work email address.', 'error');
      return;
    }
    if (!inviteFullName.trim()) {
      showToast('Please enter the user full name.', 'error');
      return;
    }
    if (!inviteServiceNumber.trim()) {
      showToast('Please enter the service number.', 'error');
      return;
    }
    if (!inviteMobileNumber.trim()) {
      showToast('Please enter the mobile number.', 'error');
      return;
    }

    setInviteLoading(true);
    try {
      const currentAdmin = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
      const res = await axios.post(
        '/api/admin/invite-user',
        {
          email: inviteEmail.trim(),
          name: inviteFullName.trim(),
          section: inviteSection,
          subSection: inviteSection === 'REBM' ? inviteSubSection : '',
          designation: inviteDesignation,
          userType: inviteSection === 'REBM'
            ? `REBM - ${inviteSubSection} (${inviteDesignation})`
            : `${inviteSection} (${inviteDesignation})`,
          rebmArea: inviteSection === 'REBM' ? inviteSubSection : '',
          serviceNumber: inviteServiceNumber.trim(),
          mobileNumber: inviteMobileNumber.trim(),
          role: inviteRole,
          invitedBy: currentAdmin || 'Administrator',
          requesterEmail: currentAdmin
        },
        { headers: { 'x-user-email': currentAdmin } }
      );

      if (res.data.success) {
        showToast(res.data.message || `Access granted to ${inviteEmail}! Invitation email sent.`, 'success');
        setInviteEmail('');
        setInviteFullName('');
        setInviteServiceNumber('');
        setInviteMobileNumber('');
        fetchUsers();
        setActiveTab('approved');
      } else {
        showToast(res.data.error || 'Failed to authorize user.', 'error');
      }
    } catch (err) {
      showToast(err.response?.data?.error || 'Error authorizing user.', 'error');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleUserAction = async (userId, action, reason = '') => {
    setActionLoading(true);
    try {
      const currentAdmin = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
      const res = await axios.post(
        '/api/admin/user-action',
        {
          userId,
          action,
          reason,
          requesterEmail: currentAdmin
        },
        { headers: { 'x-user-email': currentAdmin } }
      );

      if (res.data.success) {
        showToast(res.data.message, 'success');
        fetchUsers();
      } else {
        showToast(res.data.error || 'Action failed.', 'error');
      }
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to update user status.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        padding: '2rem'
      }}>
        <div style={{
          background: '#ffffff',
          padding: '3rem 2.5rem',
          borderRadius: '1.25rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          width: '100%',
          maxWidth: '420px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '1rem', background: 'rgba(0, 102, 255, 0.1)',
            color: '#0066FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto'
          }}>
            <ShieldCheck size={32} />
          </div>

          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.35rem' }}>
            Administrator Portal
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: '1.75rem' }}>
            Manage organization access permissions & authorizations
          </p>

          {loginError && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626',
              borderRadius: '0.75rem', padding: '0.75rem', fontSize: '0.85rem', marginBottom: '1.25rem'
            }}>
              {loginError}
            </div>
          )}

          <form onSubmit={handleAdminLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                Admin Email
              </label>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="lahirus@slt.com.lk"
                required
                style={{
                  width: '100%', padding: '0.75rem 1rem', fontSize: '0.9rem',
                  border: '1px solid #cbd5e1', borderRadius: '0.75rem', outline: 'none'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                Admin Master Password
              </label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{
                  width: '100%', padding: '0.75rem 1rem', fontSize: '0.9rem',
                  border: '1px solid #cbd5e1', borderRadius: '0.75rem', outline: 'none'
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                width: '100%', padding: '0.85rem', fontSize: '0.95rem', fontWeight: 700,
                color: '#ffffff', background: '#0066FF', border: 'none', borderRadius: '0.75rem',
                cursor: loginLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem'
              }}
            >
              {loginLoading ? <Loader2 size={18} className="spin" /> : 'Sign In as Administrator'}
            </button>
          </form>

          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            <Link to="/login" style={{ fontSize: '0.85rem', color: '#0066FF', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <ArrowLeft size={14} /> Back to User Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pendingUsers = users.filter(u => u.status === 'pending_approval');
  const approvedUsers = users.filter(u => u.status === 'approved');
  const declinedUsers = users.filter(u => u.status === 'declined');

  const filteredUsers = users.filter(u => {
    const matchesTab =
      activeTab === 'all' ? true :
      activeTab === 'pending' ? u.status === 'pending_approval' :
      activeTab === 'approved' ? u.status === 'approved' :
      activeTab === 'declined' ? u.status === 'declined' : true;

    // Resolve Section & Designation for matching
    const rawSection = u.section || (u.userType && u.userType.includes('REBM') ? 'REBM' : (u.department || ''));
    const isRebm = rawSection === 'REBM' || rawSection.includes('REBM') || !!u.rebmArea;
    const resolvedSection = isRebm ? 'REBM' : rawSection;
    const matchesSection = sectionFilter === 'all' || resolvedSection === sectionFilter;

    const rawSubSection = u.subSection || u.rebmArea || '';
    const matchesSubSection = subSectionFilter === 'all' || rawSubSection === subSectionFilter;

    const resolvedDesignation = u.designation || ((u.userType && u.userType.toLowerCase().includes('section')) ? 'Section Manager' : 'Account Manager');
    const matchesDesignation = designationFilter === 'all' || resolvedDesignation === designationFilter;

    const matchesSearch =
      (u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.serviceNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.mobileNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.section || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.subSection || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.designation || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.rebmArea || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.userType || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.department || '').toLowerCase().includes(searchTerm.toLowerCase());

    return matchesTab && matchesSection && matchesSubSection && matchesDesignation && matchesSearch;
  });

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, sans-serif' }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 9999,
          background: toast.type === 'error' ? '#ef4444' : '#10b981', color: '#ffffff',
          padding: '0.85rem 1.5rem', borderRadius: '0.75rem', boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.9rem', fontWeight: 600
        }}>
          {toast.type === 'error' ? <XCircle size={18} /> : <CheckCircle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Admin Top Navbar */}
      <header style={{
        background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <img src="/insighthub-logo.png" alt="InsightHub" style={{ height: '36px', width: 'auto' }} />
          <div style={{ height: '24px', width: '1px', background: '#cbd5e1' }}></div>
          <div>
            <h1 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
              Access Permission & User Management
            </h1>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: 0 }}>
              SLT-Mobitel Enterprise Access Control
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link
            to="/dashboard"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.55rem 1rem', borderRadius: '0.6rem', background: '#f1f5f9',
              color: '#334155', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 600
            }}
          >
            Go to Sales Dashboard
          </Link>
          <button
            onClick={handleAdminLogout}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.55rem 1rem', borderRadius: '0.6rem', background: '#fee2e2',
              color: '#dc2626', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600
            }}
          >
            <LogOut size={15} /> Sign Out
          </button>
        </div>
      </header>

      {/* Main Admin Content Container */}
      <div style={{ maxWidth: '1200px', margin: '2rem auto', padding: '0 1.5rem' }}>
        {/* KPI Stats Banner */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ background: '#ffffff', padding: '1.25rem 1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Pending Requests</span>
              <Clock size={20} style={{ color: '#f59e0b' }} />
            </div>
            <p style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f59e0b', margin: 0 }}>{pendingUsers.length}</p>
          </div>

          <div style={{ background: '#ffffff', padding: '1.25rem 1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Authorized Users</span>
              <CheckCircle size={20} style={{ color: '#10b981' }} />
            </div>
            <p style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981', margin: 0 }}>{approvedUsers.length}</p>
          </div>

          <div style={{ background: '#ffffff', padding: '1.25rem 1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Declined Requests</span>
              <XCircle size={20} style={{ color: '#ef4444' }} />
            </div>
            <p style={{ fontSize: '1.8rem', fontWeight: 800, color: '#ef4444', margin: 0 }}>{declinedUsers.length}</p>
          </div>

          <div style={{ background: '#ffffff', padding: '1.25rem 1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Total Accounts</span>
              <Users size={20} style={{ color: '#0066FF' }} />
            </div>
            <p style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0066FF', margin: 0 }}>{users.length}</p>
          </div>
        </div>

        {/* Action Tabs Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', background: '#e2e8f0', padding: '0.35rem', borderRadius: '0.75rem' }}>
            <button
              onClick={() => setActiveTab('invite')}
              style={{
                padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none',
                background: activeTab === 'invite' ? '#0066FF' : 'transparent',
                color: activeTab === 'invite' ? '#ffffff' : '#475569',
                fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
              }}
            >
              <UserPlus size={15} /> Invite / Authorize SLT Users
            </button>

            <button
              onClick={() => setActiveTab('pending')}
              style={{
                padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none',
                background: activeTab === 'pending' ? '#ffffff' : 'transparent',
                color: activeTab === 'pending' ? '#0f172a' : '#475569',
                fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
                boxShadow: activeTab === 'pending' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              Pending ({pendingUsers.length})
            </button>

            <button
              onClick={() => setActiveTab('approved')}
              style={{
                padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none',
                background: activeTab === 'approved' ? '#ffffff' : 'transparent',
                color: activeTab === 'approved' ? '#0f172a' : '#475569',
                fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                boxShadow: activeTab === 'approved' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              Authorized ({approvedUsers.length})
            </button>

            <button
              onClick={() => setActiveTab('all')}
              style={{
                padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none',
                background: activeTab === 'all' ? '#ffffff' : 'transparent',
                color: activeTab === 'all' ? '#0f172a' : '#475569',
                fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                boxShadow: activeTab === 'all' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              All Users ({users.length})
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Section Filter */}
            <select
              value={sectionFilter}
              onChange={(e) => {
                setSectionFilter(e.target.value);
                if (e.target.value !== 'REBM') {
                  setSubSectionFilter('all');
                }
              }}
              style={{
                padding: '0.55rem 0.85rem', fontSize: '0.85rem', fontWeight: 600,
                border: '1px solid #cbd5e1', borderRadius: '0.6rem', outline: 'none', background: '#ffffff', color: '#334155'
              }}
            >
              <option value="all">All Sections</option>
              {ENTERPRISE_SECTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {/* REBM Sub-Section Filter */}
            {(sectionFilter === 'all' || sectionFilter === 'REBM') && (
              <select
                value={subSectionFilter}
                onChange={(e) => setSubSectionFilter(e.target.value)}
                style={{
                  padding: '0.55rem 0.85rem', fontSize: '0.85rem', fontWeight: 600,
                  border: '1px solid #cbd5e1', borderRadius: '0.6rem', outline: 'none', background: '#ffffff', color: '#334155'
                }}
              >
                <option value="all">All REBM Sub-Sections</option>
                {REBM_SUB_SECTIONS.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            )}

            {/* Designation Filter */}
            <select
              value={designationFilter}
              onChange={(e) => setDesignationFilter(e.target.value)}
              style={{
                padding: '0.55rem 0.85rem', fontSize: '0.85rem', fontWeight: 600,
                border: '1px solid #cbd5e1', borderRadius: '0.6rem', outline: 'none', background: '#ffffff', color: '#334155'
              }}
            >
              <option value="all">All Designations</option>
              {DESIGNATIONS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <div style={{ position: 'relative', width: '220px' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%', padding: '0.55rem 0.75rem 0.55rem 2.2rem', fontSize: '0.85rem',
                  border: '1px solid #cbd5e1', borderRadius: '0.6rem', outline: 'none', background: '#ffffff'
                }}
              />
            </div>

            <button
              onClick={fetchUsers}
              disabled={loading}
              title="Refresh users"
              style={{
                padding: '0.55rem 0.75rem', borderRadius: '0.6rem', border: '1px solid #cbd5e1',
                background: '#ffffff', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem'
              }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* Tab 1: Invite / Authorize SLT Users Form */}
        {activeTab === 'invite' && (
          <div style={{
            background: '#ffffff', padding: '2rem 2.5rem', borderRadius: '1rem',
            border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', marginBottom: '2rem'
          }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 0.25rem 0', color: '#0f172a' }}>
                Pre-Authorize & Add User
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
                Select the user's <strong>Enterprise Section</strong>, <strong>REBM Sub-Section</strong> (if applicable), <strong>Status / Designation</strong> (Section Manager or Account Manager), and employee credentials.
              </p>
            </div>

            <form onSubmit={handleInviteUser} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', alignItems: 'flex-end' }}>
              {/* 1. Section Dropdown */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
                  Section *
                </label>
                <select
                  value={inviteSection}
                  onChange={(e) => setInviteSection(e.target.value)}
                  style={{
                    width: '100%', padding: '0.7rem 0.85rem', fontSize: '0.88rem', fontWeight: 600,
                    border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none', background: '#ffffff', color: '#0f172a'
                  }}
                >
                  {ENTERPRISE_SECTIONS.map(sec => (
                    <option key={sec} value={sec}>{sec}</option>
                  ))}
                </select>
              </div>

              {/* 2. REBM Sub-Section Dropdown (Only shown if Section is REBM) */}
              {inviteSection === 'REBM' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
                    REBM Sub-Section (19 Areas) *
                  </label>
                  <select
                    value={inviteSubSection}
                    onChange={(e) => setInviteSubSection(e.target.value)}
                    style={{
                      width: '100%', padding: '0.7rem 0.85rem', fontSize: '0.88rem', fontWeight: 600,
                      border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none', background: '#ffffff', color: '#0f172a'
                    }}
                  >
                    {REBM_SUB_SECTIONS.map(area => (
                      <option key={area} value={area}>{area}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* 3. Status / Designation */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
                  Status / Designation *
                </label>
                <select
                  value={inviteDesignation}
                  onChange={(e) => setInviteDesignation(e.target.value)}
                  style={{
                    width: '100%', padding: '0.7rem 0.85rem', fontSize: '0.88rem', fontWeight: 600,
                    border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none', background: '#ffffff', color: '#0f172a'
                  }}
                >
                  {DESIGNATIONS.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* 4. Full Name of the User */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
                  Full Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Kamal Perera"
                  value={inviteFullName}
                  onChange={(e) => setInviteFullName(e.target.value)}
                  required
                  style={{
                    width: '100%', padding: '0.7rem 0.85rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none'
                  }}
                />
              </div>

              {/* 5. Service Number */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
                  Service Number *
                </label>
                <input
                  type="text"
                  placeholder="e.g. 020601"
                  value={inviteServiceNumber}
                  onChange={(e) => setInviteServiceNumber(e.target.value)}
                  required
                  style={{
                    width: '100%', padding: '0.7rem 0.85rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none'
                  }}
                />
              </div>

              {/* 6. Mobile Number */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
                  Mobile Number *
                </label>
                <input
                  type="tel"
                  placeholder="e.g. 0712345678"
                  value={inviteMobileNumber}
                  onChange={(e) => setInviteMobileNumber(e.target.value)}
                  required
                  style={{
                    width: '100%', padding: '0.7rem 0.85rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none'
                  }}
                />
              </div>

              {/* 7. Email */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
                  Email (@slt.com.lk) *
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="email"
                    placeholder="user@slt.com.lk"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    style={{
                      width: '100%', padding: '0.7rem 0.85rem 0.7rem 2.3rem', fontSize: '0.88rem',
                      border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none'
                    }}
                  />
                </div>
              </div>

              {/* 8. Access Role */}
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.35rem' }}>
                  Platform Access Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{
                    width: '100%', padding: '0.7rem 0.85rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none', background: '#ffffff', color: '#0f172a'
                  }}
                >
                  <option value="user">Standard User ({inviteDesignation})</option>
                  <option value="admin">Administrator (Full Access)</option>
                </select>
              </div>

              {/* Submit Button */}
              <div>
                <button
                  type="submit"
                  disabled={inviteLoading}
                  style={{
                    width: '100%', padding: '0.75rem 1.25rem', fontSize: '0.9rem', fontWeight: 700,
                    color: '#ffffff', background: '#0066FF', border: 'none', borderRadius: '0.65rem',
                    cursor: inviteLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    boxShadow: '0 4px 12px rgba(0, 102, 255, 0.25)'
                  }}
                >
                  {inviteLoading ? <Loader2 size={16} className="spin" /> : <><Check size={16} /> Add User & Grant Access</>}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Users Table */}
        <div style={{
          background: '#ffffff', borderRadius: '1rem', border: '1px solid #e2e8f0',
          boxShadow: '0 4px 12px rgba(0,0,0,0.03)', overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>User / Full Name</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Work Email</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Section / Unit</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Designation</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Mobile Number</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Access Status</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '3rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                    No user records found matching the current filters.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isApproved = u.status === 'approved';
                  const isPending = u.status === 'pending_approval';
                  const isDeclined = u.status === 'declined';
                  const isSectionMgr = (u.designation && u.designation.toLowerCase().includes('section')) ||
                                       (u.userType && u.userType.toLowerCase().includes('section'));
                  const displayDesignation = isSectionMgr ? 'Section Manager' : 'Account Manager';
                  const isRebm = u.section === 'REBM' || (u.userType && u.userType.includes('REBM')) || !!u.rebmArea;
                  const displaySection = isRebm
                    ? `REBM - ${u.subSection || u.rebmArea || ''}`
                    : (u.section || u.department || 'Enterprise Large');

                  return (
                    <tr key={u.id || u.email} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}>
                      <td style={{ padding: '1rem 1.25rem' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{u.name || u.email.split('@')[0]}</div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
                          {u.serviceNumber ? (
                            <span>Service No: <strong>{u.serviceNumber}</strong></span>
                          ) : (
                            <span>Service No: —</span>
                          )}
                        </div>
                      </td>

                      <td style={{ padding: '1rem 1.25rem' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#0066FF', fontWeight: 600 }}>
                          {u.email}
                        </span>
                        {u.role === 'admin' && (
                          <div style={{ marginTop: '0.25rem' }}>
                            <span style={{
                              display: 'inline-block', fontSize: '0.68rem', fontWeight: 800,
                              padding: '0.1rem 0.45rem', borderRadius: '0.35rem',
                              background: '#ede9fe', color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.04em'
                            }}>
                              Admin
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Section / Unit */}
                      <td style={{ padding: '1rem 1.25rem' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center',
                          fontSize: '0.75rem', fontWeight: 700,
                          padding: '0.25rem 0.65rem', borderRadius: '0.4rem',
                          background: isRebm ? '#f0fdf4' : '#f8fafc',
                          color: isRebm ? '#166534' : '#0f172a',
                          border: `1px solid ${isRebm ? '#bbf7d0' : '#cbd5e1'}`
                        }}>
                          {displaySection}
                        </span>
                      </td>

                      {/* Designation */}
                      <td style={{ padding: '1rem 1.25rem' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center',
                          fontSize: '0.75rem', fontWeight: 700,
                          padding: '0.25rem 0.65rem', borderRadius: '0.4rem',
                          background: isSectionMgr ? '#dcfce7' : '#eff6ff',
                          color: isSectionMgr ? '#15803d' : '#1d4ed8',
                          border: `1px solid ${isSectionMgr ? '#86efac' : '#bfdbfe'}`
                        }}>
                          {displayDesignation}
                        </span>
                      </td>

                      <td style={{ padding: '1rem 1.25rem', color: '#334155', fontSize: '0.85rem' }}>
                        {u.mobileNumber || '—'}
                      </td>

                      <td style={{ padding: '1rem 1.25rem' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                          padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.78rem', fontWeight: 700,
                          background: isApproved ? '#dcfce7' : isPending ? '#fef3c7' : '#fee2e2',
                          color: isApproved ? '#166534' : isPending ? '#92400e' : '#991b1b'
                        }}>
                          {isApproved && <CheckCircle size={13} />}
                          {isPending && <Clock size={13} />}
                          {isDeclined && <XCircle size={13} />}
                          {isApproved ? 'Authorized' : isPending ? 'Pending Approval' : 'Declined'}
                        </span>
                      </td>

                      <td style={{ padding: '1rem 1.25rem', textAlign: 'right' }}>
                        {isPending ? (
                          <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                            <button
                              onClick={() => handleUserAction(u.id, 'approve')}
                              disabled={actionLoading}
                              title="Approve user"
                              style={{
                                padding: '0.45rem 0.85rem', borderRadius: '0.5rem', border: 'none',
                                background: '#10b981', color: '#ffffff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: '0.3rem'
                              }}
                            >
                              <Check size={14} /> Approve
                            </button>
                            <button
                              onClick={() => handleUserAction(u.id, 'decline')}
                              disabled={actionLoading}
                              title="Decline request"
                              style={{
                                padding: '0.45rem 0.85rem', borderRadius: '0.5rem', border: 'none',
                                background: '#ef4444', color: '#ffffff', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: '0.3rem'
                              }}
                            >
                              <X size={14} /> Decline
                            </button>
                          </div>
                        ) : isApproved && u.role !== 'admin' ? (
                          <button
                            onClick={() => handleUserAction(u.id, 'revoke')}
                            disabled={actionLoading}
                            title="Revoke access"
                            style={{
                              padding: '0.45rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #fecaca',
                              background: '#fff1f2', color: '#dc2626', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem'
                            }}
                          >
                            <Trash2 size={13} /> Revoke Access
                          </button>
                        ) : isDeclined ? (
                          <button
                            onClick={() => handleUserAction(u.id, 'approve')}
                            disabled={actionLoading}
                            title="Re-authorize user"
                            style={{
                              padding: '0.45rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #bfdbfe',
                              background: '#eff6ff', color: '#0066FF', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem'
                            }}
                          >
                            <Check size={13} /> Re-Authorize
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Master Admin</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminPortal;

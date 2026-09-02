import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck, Users, CheckCircle, XCircle, Clock, Search,
  Eye, RefreshCw, LogOut, ArrowLeft, Loader2, AlertCircle,
  FileText, ExternalLink, X, Check, UserPlus, Mail, Building, Briefcase, Trash2
} from 'lucide-react';
import axios from 'axios';

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

  // Invite User Form State
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteDepartment, setInviteDepartment] = useState('Enterprise Sales & Solutions');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviteLoading, setInviteLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const isAuth = localStorage.getItem('insightHub_adminAuth');
    const storedEmail = localStorage.getItem('userEmail');
    if (isAuth === 'true' || storedEmail?.includes('shalikahathurusinghe3584@gmail.com') || storedEmail?.includes('admin')) {
      setIsAuthenticated(true);
      fetchUsers();
    }
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/admin/users');
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
      // Master admin check
      const masterAdminEmail = 'shalikahathurusinghe3584@gmail.com';
      if (
        (adminEmail.trim().toLowerCase() === masterAdminEmail && adminPassword === 'Admin@Mobitel2026!') ||
        (adminEmail.trim().toLowerCase().includes('admin') && adminPassword === 'Admin@Mobitel2026!')
      ) {
        setIsAuthenticated(true);
        localStorage.setItem('insightHub_adminAuth', 'true');
        localStorage.setItem('userEmail', adminEmail.trim());
        fetchUsers();
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
    setIsAuthenticated(false);
  };

  const handleInviteUser = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      showToast('Please provide an email address.', 'error');
      return;
    }

    setInviteLoading(true);
    try {
      const res = await axios.post('/api/admin/invite-user', {
        email: inviteEmail.trim(),
        name: inviteName.trim() || inviteEmail.trim().split('@')[0],
        department: inviteDepartment,
        role: inviteRole,
        invitedBy: 'Administrator'
      });

      if (res.data.success) {
        showToast(res.data.message || `Access granted to ${inviteEmail}! Invitation email sent.`, 'success');
        setInviteEmail('');
        setInviteName('');
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
      const res = await axios.post('/api/admin/user-action', {
        userId,
        action,
        reason
      });

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
                placeholder="shalikahathurusinghe3584@gmail.com"
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

    const matchesSearch =
      (u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.department || '').toLowerCase().includes(searchTerm.toLowerCase());

    return matchesTab && matchesSearch;
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ position: 'relative', width: '260px' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Search by name, email, department..."
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
                Pre-Authorize & Invite SLT Users
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
                When you add an <code>@slt.com.lk</code> email address here, the user receives an automated invitation email and is pre-approved to sign in with their Microsoft Work Account.
              </p>
            </div>

            <form onSubmit={handleInviteUser} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                  Work Email (@slt.com.lk) *
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
                      width: '100%', padding: '0.65rem 0.85rem 0.65rem 2.3rem', fontSize: '0.88rem',
                      border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none'
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                  Employee Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Kamal Perera"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  style={{
                    width: '100%', padding: '0.65rem 0.85rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                  Department / Division
                </label>
                <select
                  value={inviteDepartment}
                  onChange={(e) => setInviteDepartment(e.target.value)}
                  style={{
                    width: '100%', padding: '0.65rem 0.85rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none', background: '#ffffff'
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

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                  Access Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{
                    width: '100%', padding: '0.65rem 0.85rem', fontSize: '0.88rem',
                    border: '1px solid #cbd5e1', borderRadius: '0.65rem', outline: 'none', background: '#ffffff'
                  }}
                >
                  <option value="user">Standard User (Sales Rep / Consultant)</option>
                  <option value="admin">Administrator (Full Access)</option>
                </select>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={inviteLoading}
                  style={{
                    width: '100%', padding: '0.7rem 1.25rem', fontSize: '0.9rem', fontWeight: 700,
                    color: '#ffffff', background: '#10b981', border: 'none', borderRadius: '0.65rem',
                    cursor: inviteLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
                  }}
                >
                  {inviteLoading ? <Loader2 size={16} className="spin" /> : <><Check size={16} /> Grant Access & Send Invite</>}
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
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>User / Employee</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Work Email (@slt.com.lk)</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Department / Role</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700 }}>Access Status</th>
                <th style={{ padding: '0.85rem 1.25rem', fontWeight: 700, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '3rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                    No user records found in this view.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isApproved = u.status === 'approved';
                  const isPending = u.status === 'pending_approval';
                  const isDeclined = u.status === 'declined';

                  return (
                    <tr key={u.id || u.email} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}>
                      <td style={{ padding: '1rem 1.25rem' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{u.name || u.email.split('@')[0]}</div>
                        {u.designation && <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{u.designation}</div>}
                      </td>

                      <td style={{ padding: '1rem 1.25rem' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#0066FF', fontWeight: 600 }}>
                          {u.email}
                        </span>
                      </td>

                      <td style={{ padding: '1rem 1.25rem', color: '#334155' }}>
                        <div>{u.department || 'SLT Enterprise'}</div>
                        <span style={{
                          display: 'inline-block', fontSize: '0.72rem', fontWeight: 700,
                          padding: '0.15rem 0.5rem', borderRadius: '0.4rem',
                          background: u.role === 'admin' ? '#ede9fe' : '#f1f5f9',
                          color: u.role === 'admin' ? '#6d28d9' : '#475569', marginTop: '0.2rem'
                        }}>
                          {u.role === 'admin' ? 'Administrator' : 'Standard User'}
                        </span>
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

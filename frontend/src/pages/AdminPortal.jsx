import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck, Users, CheckCircle, XCircle, Clock, Search,
  Eye, RefreshCw, LogOut, ArrowLeft, Loader2, AlertCircle,
  FileText, ExternalLink, X, Check
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
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'approved' | 'declined' | 'all'
  const [searchTerm, setSearchTerm] = useState('');

  // KYC Inspection Modal
  const [selectedUser, setSelectedUser] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const isAuth = localStorage.getItem('insightHub_adminAuth');
    if (isAuth === 'true') {
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
      const res = await axios.post('/api/auth/login', {
        email: adminEmail.trim(),
        password: adminPassword
      });

      if (res.data.success && (res.data.user.role === 'admin' || res.data.user.email.includes('admin') || res.data.user.email.includes('shalikahathurusinghe3584@gmail.com'))) {
        setIsAuthenticated(true);
        localStorage.setItem('insightHub_adminAuth', 'true');
        localStorage.setItem('userEmail', res.data.user.email);
        fetchUsers();
      } else {
        setLoginError('Access denied: You do not have administrator permissions.');
      }
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
        setSelectedUser(null);
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
            Administrator Access
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: '1.75rem' }}>
            Sign in with administrator credentials to manage user registrations
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
                placeholder="admin@mobitel.lk"
                required
                style={{
                  width: '100%', padding: '0.75rem 1rem', borderRadius: '0.75rem',
                  border: '1px solid #cbd5e1', fontSize: '0.9rem', outline: 'none'
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                Admin Password
              </label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                style={{
                  width: '100%', padding: '0.75rem 1rem', borderRadius: '0.75rem',
                  border: '1px solid #cbd5e1', fontSize: '0.9rem', outline: 'none'
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                width: '100%', padding: '0.85rem', borderRadius: '0.75rem', border: 'none',
                background: '#0066FF', color: '#ffffff', fontWeight: 700, fontSize: '0.95rem',
                cursor: loginLoading ? 'not-allowed' : 'pointer', marginTop: '0.5rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
              }}
            >
              {loginLoading ? <Loader2 size={18} className="spin" /> : 'Enter Admin Portal'}
            </button>
          </form>

          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            <Link to="/login" style={{ color: '#64748b', fontSize: '0.85rem', textDecoration: 'none' }}>
              ← Return to User Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Filter users by tab & search
  const pendingUsers = users.filter(u => u.status === 'pending_approval');
  const approvedUsers = users.filter(u => u.status === 'approved');
  const declinedUsers = users.filter(u => u.status === 'declined');

  const displayedUsers = users
    .filter(u => activeTab === 'all' || u.status === (activeTab === 'pending' ? 'pending_approval' : activeTab))
    .filter(u => {
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      return (
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.nicNumber && u.nicNumber.toLowerCase().includes(q)) ||
        (u.regNumber && u.regNumber.toLowerCase().includes(q))
      );
    });

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '2rem' }}>
      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          <CheckCircle size={18} />
          {toast.message}
        </div>
      )}

      {/* Top Navigation */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#ffffff', padding: '1rem 2rem', borderRadius: '1rem',
        border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.03)', marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img src="/insighthub-logo.png" alt="InsightHub" style={{ maxHeight: '45px' }} />
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Administration & Access Portal
            </h1>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
              User Registration & Identity Verification Control Center
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              background: '#f1f5f9', color: '#334155', border: 'none', padding: '0.6rem 1.1rem',
              borderRadius: '0.6rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer'
            }}
          >
            Dashboard
          </button>
          <button
            onClick={handleAdminLogout}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              background: '#fee2e2', color: '#dc2626', border: 'none', padding: '0.6rem 1.1rem',
              borderRadius: '0.6rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer'
            }}
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>Pending Approvals</span>
            <span style={{ padding: '0.25rem 0.6rem', borderRadius: '1rem', background: '#fef3c7', color: '#d97706', fontSize: '0.75rem', fontWeight: 700 }}>
              Action Required
            </span>
          </div>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: '#d97706', margin: '0.75rem 0 0 0' }}>
            {pendingUsers.length}
          </p>
        </div>

        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>Approved Users</span>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: '#10b981', margin: '0.75rem 0 0 0' }}>
            {approvedUsers.length}
          </p>
        </div>

        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>Declined Requests</span>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: '#ef4444', margin: '0.75rem 0 0 0' }}>
            {declinedUsers.length}
          </p>
        </div>

        <div style={{ background: '#ffffff', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 15px rgba(0,0,0,0.02)' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>Total Registrations</span>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: '#0066FF', margin: '0.75rem 0 0 0' }}>
            {users.length}
          </p>
        </div>
      </div>

      {/* Table Section */}
      <div style={{ background: '#ffffff', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.02)', padding: '1.5rem' }}>
        {/* Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', background: '#f1f5f9', padding: '0.35rem', borderRadius: '0.75rem' }}>
            {[
              { id: 'pending', label: `Pending (${pendingUsers.length})` },
              { id: 'approved', label: `Approved (${approvedUsers.length})` },
              { id: 'declined', label: `Declined (${declinedUsers.length})` },
              { id: 'all', label: `All Users (${users.length})` }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '0.5rem 1.1rem', borderRadius: '0.55rem', border: 'none',
                  fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                  background: activeTab === tab.id ? '#ffffff' : 'transparent',
                  color: activeTab === tab.id ? '#0066FF' : '#64748b',
                  boxShadow: activeTab === tab.id ? '0 2px 8px rgba(0,0,0,0.05)' : 'none'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search & Refresh */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search user, email, NIC..."
                style={{
                  padding: '0.5rem 1rem 0.5rem 2.4rem', borderRadius: '0.6rem',
                  border: '1px solid #cbd5e1', fontSize: '0.85rem', outline: 'none', width: '220px'
                }}
              />
            </div>
            <button
              onClick={fetchUsers}
              disabled={loading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                background: '#f8fafc', border: '1px solid #cbd5e1', padding: '0.5rem 0.9rem',
                borderRadius: '0.6rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer'
              }}
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {/* User Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>Applicant</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>Work Email</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>NIC & Reg No</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>KYC Photos</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>Status</th>
                <th style={{ padding: '0.75rem 1rem', fontSize: '0.78rem', color: '#475569', textTransform: 'uppercase', fontWeight: 700 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedUsers.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>
                    No users found matching this filter.
                  </td>
                </tr>
              ) : (
                displayedUsers.map(user => (
                  <tr key={user.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '1rem', fontSize: '0.9rem', fontWeight: 600, color: '#0f172a' }}>
                      {user.name}
                    </td>
                    <td style={{ padding: '1rem', fontSize: '0.88rem', color: '#0066FF', fontWeight: 500 }}>
                      {user.email}
                    </td>
                    <td style={{ padding: '1rem', fontSize: '0.85rem', color: '#334155' }}>
                      <div>NIC: <strong>{user.nicNumber}</strong></div>
                      <div style={{ color: '#64748b', fontSize: '0.8rem' }}>Reg: {user.regNumber}</div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {user.nicPhotoUrl && (
                          <img src={user.nicPhotoUrl} alt="NIC" style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover', border: '1px solid #cbd5e1' }} />
                        )}
                        {user.facePhotoUrl && (
                          <img src={user.facePhotoUrl} alt="Face" style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #cbd5e1' }} />
                        )}
                        <button
                          onClick={() => setSelectedUser(user)}
                          style={{
                            background: '#f1f5f9', border: 'none', padding: '0.35rem 0.6rem',
                            borderRadius: '0.4rem', fontSize: '0.75rem', fontWeight: 600, color: '#334155', cursor: 'pointer'
                          }}
                        >
                          View KYC
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <span style={{
                        padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.78rem', fontWeight: 700,
                        background: user.status === 'approved' ? 'rgba(16, 185, 129, 0.1)' : user.status === 'declined' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                        color: user.status === 'approved' ? '#10b981' : user.status === 'declined' ? '#ef4444' : '#d97706'
                      }}>
                        {user.status === 'pending_approval' ? 'Pending Approval' : user.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      {user.status === 'pending_approval' ? (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => handleUserAction(user.id, 'approve')}
                            disabled={actionLoading}
                            style={{
                              background: '#10b981', color: '#ffffff', border: 'none', padding: '0.4rem 0.8rem',
                              borderRadius: '0.5rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: '0.25rem'
                            }}
                          >
                            <Check size={14} /> Approve
                          </button>
                          <button
                            onClick={() => handleUserAction(user.id, 'decline')}
                            disabled={actionLoading}
                            style={{
                              background: '#ef4444', color: '#ffffff', border: 'none', padding: '0.4rem 0.8rem',
                              borderRadius: '0.5rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: '0.25rem'
                            }}
                          >
                            <X size={14} /> Decline
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                          {user.approvedAt ? `Approved ${new Date(user.approvedAt).toLocaleDateString()}` : 'Processed'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* KYC Inspection Modal */}
      {selectedUser && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem'
        }}>
          <div style={{
            background: '#ffffff', borderRadius: '1.25rem', padding: '2rem', width: '100%',
            maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto', position: 'relative'
          }}>
            <button
              onClick={() => setSelectedUser(null)}
              style={{
                position: 'absolute', top: '1.25rem', right: '1.25rem', background: '#f1f5f9',
                border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <X size={18} />
            </button>

            <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.25rem 0' }}>
              Identity & KYC Verification
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 1.5rem 0' }}>
              Applicant: <strong>{selectedUser.name}</strong> ({selectedUser.email})
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: '#f8fafc', padding: '1rem', borderRadius: '0.75rem', marginBottom: '1.5rem' }}>
              <div><strong>NIC Number:</strong> {selectedUser.nicNumber}</div>
              <div><strong>Employee / Reg No:</strong> {selectedUser.regNumber}</div>
              <div><strong>Submitted:</strong> {new Date(selectedUser.createdAt).toLocaleString()}</div>
              <div><strong>Status:</strong> {selectedUser.status}</div>
            </div>

            {/* Photos Side by Side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
              <div>
                <p style={{ fontWeight: 700, fontSize: '0.85rem', color: '#334155', margin: '0 0 0.5rem 0' }}>
                  National Identity Card (NIC)
                </p>
                {selectedUser.nicPhotoUrl ? (
                  <a href={selectedUser.nicPhotoUrl} target="_blank" rel="noreferrer">
                    <img src={selectedUser.nicPhotoUrl} alt="NIC" style={{ width: '100%', maxHeight: '240px', objectFit: 'contain', border: '1px solid #cbd5e1', borderRadius: '0.75rem' }} />
                  </a>
                ) : (
                  <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No NIC image uploaded.</p>
                )}
              </div>

              <div>
                <p style={{ fontWeight: 700, fontSize: '0.85rem', color: '#334155', margin: '0 0 0.5rem 0' }}>
                  User Face Photo
                </p>
                {selectedUser.facePhotoUrl ? (
                  <a href={selectedUser.facePhotoUrl} target="_blank" rel="noreferrer">
                    <img src={selectedUser.facePhotoUrl} alt="Face" style={{ width: '100%', maxHeight: '240px', objectFit: 'contain', border: '1px solid #cbd5e1', borderRadius: '0.75rem' }} />
                  </a>
                ) : (
                  <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No Face image uploaded.</p>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            {selectedUser.status === 'pending_approval' && (
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
                <button
                  onClick={() => handleUserAction(selectedUser.id, 'decline')}
                  disabled={actionLoading}
                  style={{
                    background: '#ef4444', color: '#ffffff', border: 'none', padding: '0.75rem 1.5rem',
                    borderRadius: '0.75rem', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  Decline Registration
                </button>
                <button
                  onClick={() => handleUserAction(selectedUser.id, 'approve')}
                  disabled={actionLoading}
                  style={{
                    background: '#10b981', color: '#ffffff', border: 'none', padding: '0.75rem 1.75rem',
                    borderRadius: '0.75rem', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  Approve Registration & Send Activation Email
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPortal;

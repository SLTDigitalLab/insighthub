import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileText, Upload, Download, Trash2, Building2, Sparkles, Clock,
  ShieldCheck, CheckCircle2, AlertCircle, ArrowLeft, RefreshCw, FileUp,
  Layers, ExternalLink, Calendar, User, Search, Eye, FileSpreadsheet,
  HelpCircle, ChevronRight, Check, Info, FileCode, RotateCcw
} from 'lucide-react';
import axios from 'axios';
import ProposalAgent from '../components/ProposalAgent';
import ProposalMaintenance from '../components/ProposalMaintenance';
import ConfirmModal from '../components/ConfirmModal';

export default function ProposalHub() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTabParam = searchParams.get('tab') || 'generator'; // 'generator' | 'template' | 'archive'
  const [activeTab, setActiveTab] = useState(activeTabParam);

  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [proposalUser, setProposalUser] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'primary',
    icon: null,
    onConfirm: () => {}
  });

  // Template management state
  const [templateMeta, setTemplateMeta] = useState(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  // Saved proposals state
  const [savedProposals, setSavedProposals] = useState([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [proposalSearch, setProposalSearch] = useState('');
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [exportingId, setExportingId] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const email = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
    const name = localStorage.getItem('userName') || 'Account Manager';
    setUserEmail(email);
    setUserName(name);

    const adminEmails = ['dineshpi@slt.com.lk', '020601@intranet.slt.com.lk', 'lahirus@slt.com.lk'];
    const adminRole = localStorage.getItem('userRole') === 'admin' || adminEmails.includes(email);
    setIsAdmin(adminRole);

    fetchTemplateInfo();
    fetchSavedProposals();

    if (email) {
      axios.post('/api/auth/verify-access', { email })
        .then(res => {
          const u = (res.data && res.data.approved && res.data.user) || {};
          const clean = v => String(v || '').trim();
          setProposalUser({
            name: clean(u.name) || name,
            email: clean(u.email) || email,
            designation: clean(u.designation),
            phone: clean(u.mobileNumber),
            division: clean(u.department) || clean(u.rebmArea),
          });
        })
        .catch(() => {
          setProposalUser({ name, email, designation: '', phone: '', division: '' });
        });
    }
  }, []);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const fetchTemplateInfo = async () => {
    setTemplateLoading(true);
    try {
      const { data } = await axios.get('/api/proposals/template/info');
      if (data.template) setTemplateMeta(data.template);
    } catch (err) {
      console.warn('[ProposalHub] Template info fetch error:', err.message);
    } finally {
      setTemplateLoading(false);
    }
  };

  const fetchSavedProposals = async () => {
    setLoadingProposals(true);
    try {
      const { data } = await axios.get('/api/proposals/saved');
      if (Array.isArray(data.proposals)) {
        setSavedProposals(data.proposals);
      }
    } catch (err) {
      console.warn('[ProposalHub] Saved proposals fetch error:', err.message);
    } finally {
      setLoadingProposals(false);
    }
  };

  const handleTemplateUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      showToast('Please select a Microsoft Word (.docx) file first.', 'error');
      return;
    }
    if (!selectedFile.name.match(/\.docx$/i)) {
      showToast('Only Microsoft Word (.docx) documents are supported. Converting legacy .doc files causes formatting errors; please save as .docx in Word before uploading.', 'error');
      return;
    }

    setUploadingTemplate(true);
    showToast('Uploading .docx template directly...', 'info');
    const formData = new FormData();
    formData.append('template', selectedFile);
    formData.append('adminEmail', userEmail || 'admin');

    try {
      const { data } = await axios.post('/api/proposals/template/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      showToast(data.message || 'Latest proposal template updated successfully!');
      setSelectedFile(null);
      fetchTemplateInfo();
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to upload proposal template.', 'error');
    } finally {
      setUploadingTemplate(false);
    }
  };

  const handleResetTemplate = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Restore Default Master Template?',
      message: 'Are you sure you want to restore the official system default proposal template? This will replace the currently active template with the clean SLT-Mobitel master template.',
      confirmText: 'Yes, Restore Master Template',
      cancelText: 'Keep Current Template',
      variant: 'warning',
      icon: <RotateCcw size={24} color="#d97706" />,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        try {
          setUploadingTemplate(true);
          const { data } = await axios.post('/api/proposals/template/reset');
          showToast(data.message || 'Template restored to official system default!');
          fetchTemplateInfo();
        } catch (err) {
          showToast(err.response?.data?.error || 'Failed to restore default template.', 'error');
        } finally {
          setUploadingTemplate(false);
        }
      }
    });
  };

  const handleStartFreshProposal = () => {
    setSelectedProposal(null);
    try {
      localStorage.removeItem('insightHub_activeProposalSession');
    } catch {}
  };

  const handleDeleteProposal = (id, refNo) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Saved Proposal?',
      message: `Are you sure you want to delete proposal ${refNo || id}? This proposal will be permanently removed from your archived records.`,
      confirmText: 'Yes, Delete Proposal',
      cancelText: 'Keep Proposal',
      variant: 'danger',
      icon: <Trash2 size={24} color="#ef4444" />,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        try {
          await axios.delete(`/api/proposals/saved/${id}`);
          showToast('Proposal removed from system.');
          setSavedProposals(prev => prev.filter(p => p.id !== id && p.refNo !== id));
          if (selectedProposal && (selectedProposal.id === id || selectedProposal.refNo === id)) {
            handleStartFreshProposal();
          }
        } catch (err) {
          showToast('Failed to delete proposal.', 'error');
        }
      }
    });
  };

  const handleExportSavedProposal = async (proposal, format) => {
    const propKey = `${proposal.id}-${format}`;
    setExportingId(propKey);
    try {
      showToast(`Generating ${format.toUpperCase()} export...`, 'info');
      const res = await axios.post('/api/proposals/export', {
        fields: proposal.fields,
        format
      }, {
        responseType: 'blob'
      });
      const blob = new Blob([res.data], {
        type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${proposal.refNo || 'Proposal'}_${(proposal.companyName || 'Enterprise').replace(/[^a-z0-9]/gi, '_')}.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showToast(`${format.toUpperCase()} downloaded successfully!`);
    } catch (err) {
      console.error('Export error:', err);
      showToast(`Failed to export ${format.toUpperCase()}.`, 'error');
    } finally {
      setExportingId(null);
    }
  };

  const filteredProposals = savedProposals.filter(p => {
    const q = proposalSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      (p.companyName && p.companyName.toLowerCase().includes(q)) ||
      (p.refNo && p.refNo.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q)) ||
      (p.generatedBy && p.generatedBy.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', color: '#0f172a', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: toast.type === 'error' ? '#ef4444' : (toast.type === 'info' ? '#0284c7' : '#10b981'),
          color: '#ffffff', padding: '12px 20px', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 10,
          fontWeight: 600, fontSize: '0.9rem'
        }}>
          {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          {toast.message}
        </div>
      )}

      {/* Top Header */}
      <header className="proposal-hub-header" style={{
        background: '#ffffff', borderBottom: '1px solid #e2e8f0',
        padding: '14px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 12,
        position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/dashboard')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 12px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', color: '#475569' }}
          >
            <ArrowLeft size={16} /> Back to Dashboard
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)', flexShrink: 0 }}>
              <FileText size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#0B2A6F', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                SLT-MOBITEL Proposal Hub
                <span style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>Enterprise</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Dynamic corporate proposals, single active template system & historical proposal records</div>
            </div>
          </div>
        </div>

        {/* Tab Switcher Buttons */}
        <div className="proposal-hub-tabs">
          {isAdmin && (
            <button
              onClick={() => handleTabChange('generator')}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px',
                fontSize: '0.85rem', fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: activeTab === 'generator' ? '#ffffff' : 'transparent',
                color: activeTab === 'generator' ? '#0B2A6F' : '#64748b',
                boxShadow: activeTab === 'generator' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              <Sparkles size={16} color={activeTab === 'generator' ? '#0284c7' : '#64748b'} />
              Generate Proposal
            </button>
          )}

          <button
            onClick={() => handleTabChange('archive')}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px',
              fontSize: '0.85rem', fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: activeTab === 'archive' ? '#ffffff' : 'transparent',
              color: activeTab === 'archive' ? '#0B2A6F' : '#64748b',
              boxShadow: activeTab === 'archive' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            <Layers size={16} color={activeTab === 'archive' ? '#0284c7' : '#64748b'} />
            Generated Proposals ({savedProposals.length})
          </button>

          {isAdmin && (
            <button
              onClick={() => handleTabChange('template')}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px',
                fontSize: '0.85rem', fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: activeTab === 'template' ? '#ffffff' : 'transparent',
                color: activeTab === 'template' ? '#0B2A6F' : '#64748b',
                boxShadow: activeTab === 'template' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              <Upload size={16} color={activeTab === 'template' ? '#0284c7' : '#64748b'} />
              Upload Latest Template
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="proposal-hub-main" style={{ flex: 1, padding: activeTab === 'generator' ? '20px 24px' : '32px 36px', maxWidth: activeTab === 'generator' ? '100%' : '1350px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        
        {/* TAB 1: Proposal Generator Wizard */}
        <div style={{ display: activeTab === 'generator' ? 'block' : 'none' }}>
          {!isAdmin ? (
            <ProposalMaintenance onBack={() => navigate('/dashboard')} />
          ) : (
            <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', padding: '20px 16px' }}>
              {selectedProposal && (
                <div style={{
                  marginBottom: 20, padding: '12px 18px', background: '#eff6ff',
                  borderRadius: 8, border: '1px solid #bfdbfe',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileText size={18} color="#0284c7" />
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e3a8a' }}>
                        Editing Saved Proposal: {selectedProposal.companyName}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        Ref No: <strong>{selectedProposal.refNo}</strong> • Created: {new Date(selectedProposal.createdAt || selectedProposal.date).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleStartFreshProposal}
                    style={{
                      padding: '6px 14px', background: '#ffffff', border: '1px solid #cbd5e1',
                      borderRadius: 6, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                      color: '#0B2A6F', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    }}
                  >
                    Start Fresh Proposal
                  </button>
                </div>
              )}
              <ProposalAgent
                user={proposalUser || { name: userName, email: userEmail, designation: '', phone: '', division: '' }}
                initialProposal={selectedProposal}
                onClearProposal={handleStartFreshProposal}
              />
            </div>
          )}
        </div>

        {/* TAB 2: Upload Latest Template (Admin Only) */}
        {activeTab === 'template' && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0B2A6F', margin: '0 0 6px' }}>Upload Latest Proposal Template</h2>
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                All future proposals generated by InsightHub will strictly use this latest template. There is no template switching—uploading a new template immediately replaces and cleans up older templates from the system.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
              {/* Upload Card */}
              <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8, color: '#0B2A6F' }}>
                  <FileUp size={19} color="#0284c7" /> Replace Template (.docx only)
                </h3>

                {/* Direct DOCX Upload Guarantee Notice */}
                <div style={{
                  marginBottom: 16, padding: '12px 14px', background: '#f0fdf4',
                  borderRadius: 8, border: '1px solid #bbf7d0', fontSize: '0.83rem', color: '#166534', lineHeight: 1.5
                }}>
                  <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <CheckCircle2 size={16} color="#16a34a" />
                    Direct .docx Storage — 100% Format Preservation
                  </div>
                  <div>
                    Uploaded <strong>.docx</strong> templates are stored <strong>directly without any server-side alterations</strong>.
                    To avoid format errors, only <strong>.docx</strong> files are accepted. If you have a <code>.doc</code> file, open it in Word and click <strong>File &rarr; Save As &rarr; Word Document (.docx)</strong> first.
                  </div>
                </div>

                <form onSubmit={handleTemplateUpload}>
                  <div style={{
                    border: '2px dashed #93c5fd', borderRadius: 10, padding: '32px 20px',
                    textAlign: 'center', background: '#f0f9ff', cursor: 'pointer', transition: 'all 0.2s ease',
                    marginBottom: 14
                  }}>
                    <input
                      type="file"
                      id="template-file-input"
                      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      style={{ display: 'none' }}
                      onChange={(e) => setSelectedFile(e.target.files[0] || null)}
                    />
                    <label htmlFor="template-file-input" style={{ cursor: 'pointer', display: 'block' }}>
                      <Upload size={38} color="#0284c7" style={{ margin: '0 auto 10px' }} />
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0369a1' }}>
                        {selectedFile ? selectedFile.name : 'Click or drag Microsoft Word (.docx) template here'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 4 }}>
                        {selectedFile ? (
                          `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB ready for upload (Direct .docx — 100% Exact Preservation)`
                        ) : (
                          'Strictly .docx format — Zero conversion, 100% pixel-perfect layout preservation'
                        )}
                      </div>
                    </label>
                  </div>

                  {/* Warning if a non-docx file is dropped */}
                  {selectedFile && !selectedFile.name.match(/\.docx$/i) && (
                    <div style={{
                      marginBottom: 14, padding: '10px 14px', background: '#fef2f2', borderRadius: 6,
                      border: '1px solid #fecaca', color: '#991b1b', fontSize: '0.8rem', display: 'flex', gap: 8, alignItems: 'flex-start'
                    }}>
                      <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <strong>Legacy .doc file detected:</strong> Due to format distortion during conversion, .doc files are not supported.
                        Please open your file in Microsoft Word, click <strong>File &rarr; Save As &rarr; Word Document (.docx)</strong>, and upload the <strong>.docx</strong> file directly.
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!selectedFile || !selectedFile.name.match(/\.docx$/i) || uploadingTemplate}
                    style={{
                      width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                      background: selectedFile && selectedFile.name.match(/\.docx$/i) ? 'linear-gradient(135deg, #0284c7 0%, #0B2A6F 100%)' : '#cbd5e1',
                      color: '#ffffff', fontWeight: 700, fontSize: '0.92rem', cursor: selectedFile && selectedFile.name.match(/\.docx$/i) && !uploadingTemplate ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      boxShadow: selectedFile && selectedFile.name.match(/\.docx$/i) ? '0 4px 12px rgba(2, 132, 199, 0.25)' : 'none'
                    }}
                  >
                    {uploadingTemplate ? (
                      <>
                        <RefreshCw size={18} className="spin" /> Updating Template on Server...
                      </>
                    ) : (
                      <>
                        <Upload size={18} /> Set as Latest Template (.docx)
                      </>
                    )}
                  </button>
                </form>

                {/* Current Active Template Information */}
                <div style={{ marginTop: 24, padding: '14px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Active Template on Server</div>
                    {templateMeta?.convertedFromDoc ? (
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '1px 8px', borderRadius: 10 }}>
                        Converted from .DOC
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', padding: '1px 8px', borderRadius: 10 }}>
                        Native DOCX
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0B2A6F' }}>{templateMeta?.filename || 'proposal_template.docx'}</div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
                        Updated: {templateMeta?.updatedAt ? new Date(templateMeta.updatedAt).toLocaleString() : 'System Default'} &nbsp;•&nbsp; Size: {templateMeta?.sizeBytes ? (templateMeta.sizeBytes / (1024 * 1024)).toFixed(2) + ' MB' : '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <a
                        href="/api/proposals/template/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#eff6ff', color: '#0284c7', borderRadius: 6, border: '1px solid #bfdbfe', textDecoration: 'none', fontSize: '0.82rem', fontWeight: 700 }}
                      >
                        <Download size={14} /> Download File
                      </a>
                      <button
                        type="button"
                        onClick={handleResetTemplate}
                        disabled={uploadingTemplate}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#f8fafc', color: '#475569', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                        title="Restore the pristine system default template"
                      >
                        <RefreshCw size={13} className={uploadingTemplate ? "spin" : ""} /> Restore Default
                      </button>
                    </div>
                  </div>
                </div>

                {/* Architecture Note */}
                <div style={{ marginTop: 16, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#334155', lineHeight: 1.5 }}>
                  <strong>Zero-Conversion Guarantee:</strong> Uploading native <strong>.docx</strong> templates ensures <strong>zero conversion</strong> is performed, keeping 100% of your tables, page breaks, fonts, and vector logos exactly as designed.
                </div>
              </div>

              {/* Tag Cheatsheet Card */}
              <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 8px', color: '#0B2A6F', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 size={18} color="#10b981" /> Template Marking Guidelines
                </h3>
                <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
                  The best standard method to mark variable changing points in Microsoft Word is using docxtemplater tags: <code>{'{tag}'}</code>.
                  <br />
                  <span style={{ color: '#0284c7', fontWeight: 600 }}>Tip:</span> You can <strong>highlight</strong> or <strong>color</strong> tags in Word (e.g. yellow highlight) to see them clearly—Word formatting will be applied directly to the substituted content!
                </p>

                <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px', color: '#475569' }}>Tag in Word</th>
                        <th style={{ padding: '8px 12px', color: '#475569' }}>Field / Replacement</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                        <td colSpan={2} style={{ padding: '6px 12px', fontWeight: 700, color: '#0B2A6F', fontSize: '0.78rem' }}>COVER & CLIENT IDENTIFIERS</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{companyName}'}</td>
                        <td style={{ padding: '8px 12px' }}>Customer / Lead company name</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{refNo}'}</td>
                        <td style={{ padding: '8px 12px' }}>Unique Reference Number (SLT-xxxxxxxx)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{proposalDate}'}</td>
                        <td style={{ padding: '8px 12px' }}>Issue date (e.g. 23 OCT 2026)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{recipientDesignation}'}</td>
                        <td style={{ padding: '8px 12px' }}>Addressee title (e.g. General Manager, IT Director)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{address}'}</td>
                        <td style={{ padding: '8px 12px' }}>Company registered street / city address</td>
                      </tr>

                      <tr style={{ borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                        <td colSpan={2} style={{ padding: '6px 12px', fontWeight: 700, color: '#0B2A6F', fontSize: '0.78rem' }}>AI LETTER & ARCHITECTURE</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{@letterXml}'}</td>
                        <td style={{ padding: '8px 12px' }}>AI-written tailored cover letter paragraphs</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{@requirementsXml}'}</td>
                        <td style={{ padding: '8px 12px' }}>Product technical diagrams & feature points</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{@aboutXml}'}</td>
                        <td style={{ padding: '8px 12px' }}>"About You" company overview & recommended products</td>
                      </tr>

                      <tr style={{ borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                        <td colSpan={2} style={{ padding: '6px 12px', fontWeight: 700, color: '#0B2A6F', fontSize: '0.78rem' }}>DYNAMIC TABLES (LOOP ROWS)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{#investment} ... {/investment}'}</td>
                        <td style={{ padding: '8px 12px' }}>Repeated investment pricing table rows</td>
                      </tr>

                      <tr style={{ borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
                        <td colSpan={2} style={{ padding: '6px 12px', fontWeight: 700, color: '#0B2A6F', fontSize: '0.78rem' }}>SALES REPRESENTATIVE & SIGN-OFF</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{amName}'}, {'{amPhone}'}, {'{amEmail}'}</td>
                        <td style={{ padding: '8px 12px' }}>Account Manager contact details</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{ackCompanyName}'}, {'{ackAddress}'}</td>
                        <td style={{ padding: '8px 12px' }}>Customer acknowledgement sign-off fields</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Generated Proposals Archive */}
        {activeTab === 'archive' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0B2A6F', margin: '0 0 6px' }}>Generated Proposals Archive</h2>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                  All proposals prepared in the system are archived below with non-repeating reference numbers and full specifications.
                </p>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="text"
                    value={proposalSearch}
                    onChange={e => setProposalSearch(e.target.value)}
                    placeholder="Search company or Ref No..."
                    style={{ padding: '8px 14px 8px 36px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.85rem', width: 260 }}
                  />
                </div>
                <button
                  onClick={fetchSavedProposals}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, background: '#f1f5f9', border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                >
                  <RefreshCw size={14} className={loadingProposals ? 'spin' : ''} /> Refresh
                </button>
              </div>
            </div>

            {loadingProposals ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
                <RefreshCw size={32} className="spin" style={{ margin: '0 auto 12px', color: '#0284c7' }} />
                <p>Loading generated proposals...</p>
              </div>
            ) : filteredProposals.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', color: '#64748b' }}>
                <FileText size={48} color="#cbd5e1" style={{ margin: '0 auto 12px' }} />
                <h3 style={{ margin: '0 0 6px', color: '#1e293b' }}>No Proposals Found</h3>
                <p style={{ margin: '0 0 16px', fontSize: '0.9rem' }}>
                  {proposalSearch ? 'No proposals match your search query.' : 'Generated proposals will appear here automatically.'}
                </p>
                <button
                  onClick={() => handleTabChange('generator')}
                  style={{ padding: '8px 18px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  Generate First Proposal
                </button>
              </div>
            ) : (
              <div className="table-responsive" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', overflowX: 'auto', WebkitOverflowScrolling: 'touch', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                <table style={{ width: '100%', minWidth: '760px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700 }}>Ref Number</th>
                      <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700 }}>Customer Company</th>
                      <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700 }}>Industry</th>
                      <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700 }}>Products</th>
                      <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700 }}>Date</th>
                      <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700 }}>Prepared By</th>
                      <th style={{ padding: '12px 18px', color: '#475569', fontWeight: 700, textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProposals.map((item, idx) => (
                      <tr key={item.id || idx} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }} onMouseOver={e => e.currentTarget.style.background = '#f8fafc'} onMouseOut={e => e.currentTarget.style.background = '#ffffff'}>
                        <td style={{ padding: '14px 18px', fontFamily: 'monospace', fontWeight: 700, color: '#0369a1' }}>
                          {item.refNo}
                        </td>
                        <td style={{ padding: '14px 18px', fontWeight: 700, color: '#0B2A6F' }}>
                          {item.companyName}
                        </td>
                        <td style={{ padding: '14px 18px', color: '#64748b' }}>
                          <span style={{ fontSize: '0.78rem', background: '#f1f5f9', padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>
                            {item.category || 'Enterprise'}
                          </span>
                        </td>
                        <td style={{ padding: '14px 18px', color: '#475569', fontSize: '0.82rem' }}>
                          {Array.isArray(item.products) && item.products.length > 0 ? (
                            <span>{item.products.map(p => typeof p === 'object' ? p.name : p).slice(0, 2).join(', ')}{item.products.length > 2 ? ` +${item.products.length - 2}` : ''}</span>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '14px 18px', color: '#64748b', fontSize: '0.82rem' }}>
                          {item.date ? new Date(item.date).toLocaleDateString() : '—'}
                        </td>
                        <td style={{ padding: '14px 18px', color: '#64748b', fontSize: '0.82rem' }}>
                          {item.generatedBy || item.generatorName || 'Account Manager'}
                        </td>
                        <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
                            <button
                              onClick={() => {
                                setSelectedProposal(item);
                                handleTabChange('generator');
                              }}
                              title="Open in Document Editor"
                              style={{ padding: '5px 9px', borderRadius: 6, background: '#eff6ff', color: '#0284c7', border: '1px solid #bfdbfe', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 700 }}
                            >
                              <Eye size={13} /> Edit
                            </button>
                            
                            <button
                              onClick={() => handleExportSavedProposal(item, 'docx')}
                              disabled={exportingId === `${item.id}-docx`}
                              title="Download Word (.docx)"
                              style={{ padding: '5px 8px', borderRadius: 6, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 700 }}
                            >
                              {exportingId === `${item.id}-docx` ? <RefreshCw size={12} className="spin" /> : <Download size={12} />} Word
                            </button>

                            <button
                              onClick={() => handleExportSavedProposal(item, 'pdf')}
                              disabled={exportingId === `${item.id}-pdf`}
                              title="Download PDF"
                              style={{ padding: '5px 8px', borderRadius: 6, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 700 }}
                            >
                              {exportingId === `${item.id}-pdf` ? <RefreshCw size={12} className="spin" /> : <Download size={12} />} PDF
                            </button>

                            {isAdmin && (
                              <button
                                onClick={() => handleDeleteProposal(item.id, item.refNo)}
                                title="Delete Proposal"
                                style={{ padding: '5px 8px', borderRadius: 6, background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca', cursor: 'pointer' }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
        variant={confirmModal.variant}
        icon={confirmModal.icon}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}

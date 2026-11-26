import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileText, Upload, Download, Trash2, Building2, Sparkles, Clock,
  ShieldCheck, CheckCircle2, AlertCircle, ArrowLeft, RefreshCw, FileUp,
  Layers, ExternalLink, Calendar, User, Search, Eye, FileSpreadsheet,
  HelpCircle, ChevronRight, ChevronDown, Check, Info, FileCode, RotateCcw
} from 'lucide-react';
import axios from 'axios';
import { downloadProposalStepFile } from '../api';
import { currentStepOf, stepName, allRefsOf, currentStatusOf, rowActionOf } from '../utils/proposalSteps';
import ProposalAgent from '../components/ProposalAgent';
import ProposalStatusPanel, { STATUS_OPTIONS } from '../components/ProposalStatusPanel';
import ConfirmModal from '../components/ConfirmModal';
import SolutionTemplatePanel from '../components/SolutionTemplatePanel';
import ProductSolutionTemplatePanel from '../components/ProductSolutionTemplatePanel';
import ProposalHubHeader from '../components/ProposalHubHeader';

const statusOf = p => currentStatusOf(p); // one shared helper decides the current status of a row

export default function ProposalHub() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTabParam = searchParams.get('tab') || 'generator'; // 'generator' | 'template' | 'archive'
  const [activeTab, setActiveTab] = useState(activeTabParam);
  // Opened from the Proposal Hub's "Search Generated Proposals" button: show only the archive tab in the header
  const [archiveOnly] = useState(searchParams.get('only') === 'archive');

  const [isAdmin, setIsAdmin] = useState(false);
  const [canDelete, setCanDelete] = useState(false); // admin or Section Manager
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
  const [templateVersions, setTemplateVersions] = useState([]); // every stored template version, newest first
  const [templateLoading, setTemplateLoading] = useState(false);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [templateType, setTemplateType] = useState(() => (['solution', 'productSolution'].includes(searchParams.get('type')) ? searchParams.get('type') : 'product')); // which template the 'Upload Latest Template' tab manages: 'product' | 'solution' | 'productSolution' (?type= opens one directly)
  const [uploadResult, setUploadResult] = useState(null);

  // Saved proposals state
  const [savedProposals, setSavedProposals] = useState([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [proposalSearch, setProposalSearch] = useState('');
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [exportingId, setExportingId] = useState(null);
  const [viewOnly, setViewOnly] = useState(false); // a Confirmed / Completed product proposal opened with View
  const [expandedRef, setExpandedRef] = useState(searchParams.get('expand') || null); // refNo of the archive row whose version/status panel is open (one at a time)

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
    if (!adminRole && activeTab === 'template') handleTabChange('generator'); // template upload is admin-only
    // Delete is for admins and Section Managers only (Account Managers do not see it)
    setCanDelete(adminRole || /section\s*manager/i.test(localStorage.getItem('userDesignation') || ''));

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
      try {
        const { data: all } = await axios.get('/api/proposals/templates');
        if (Array.isArray(all.templates)) setTemplateVersions(all.templates);
      } catch (err) {
        console.warn('[ProposalHub] Template versions fetch error:', err.message);
      }
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
    if (uploadingTemplate) return; // one upload at a time
    if (!selectedFile) {
      showToast('Please select a Microsoft Word (.docx) file first.', 'error');
      return;
    }
    if (!selectedFile.name.match(/\.docx$/i)) {
      showToast('Only Microsoft Word (.docx) documents are supported. Converting legacy .doc files causes formatting errors; please save as .docx in Word before uploading.', 'error');
      return;
    }

    setUploadingTemplate(true);
    setUploadResult(null);
    showToast('Analysing the template...', 'info');
    const formData = new FormData();
    formData.append('template', selectedFile);
    formData.append('adminEmail', userEmail || 'admin');

    try {
      // One step: the server analyses the file, writes the fill-in tags into a copy, cleans it and makes it the active template
      const { data } = await axios.post('/api/proposals/templates/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000
      });
      showToast(`Template version ${data.version} is now the active template.`);
      setUploadResult(data);
      setSelectedFile(null);
      fetchTemplateInfo();
      window.dispatchEvent(new Event('proposal-template-changed')); // the editor's logo card re-reads the template info
    } catch (err) {
      const problems = err.response?.data?.problems;
      showToast([err.response?.data?.error || 'Failed to upload proposal template.', ...(problems || [])].join(' '), 'error');
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
          window.dispatchEvent(new Event('proposal-template-changed')); // the editor's logo card re-reads the template info
        } catch (err) {
          showToast(err.response?.data?.error || 'Failed to restore default template.', 'error');
        } finally {
          setUploadingTemplate(false);
        }
      }
    });
  };

  const handleDeleteVersion = (v) => {
    setConfirmModal({
      isOpen: true,
      title: `Delete Version ${v.version}?`,
      message: `Delete version ${v.version} (${v.filename}) permanently? This cannot be undone. Proposals already made with it keep working and print with the active template.`,
      confirmText: 'Yes, Delete This Version',
      cancelText: 'Keep It',
      variant: 'danger',
      icon: <Trash2 size={24} color="#dc2626" />,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        try {
          setUploadingTemplate(true);
          await axios.delete(`/api/proposals/templates/${v.id}`, { headers: { 'x-user-email': (localStorage.getItem('userEmail') || '').toLowerCase().trim() } });
          showToast(`Template version ${v.version} was deleted.`);
          fetchTemplateInfo();
        } catch (err) {
          showToast(err.response?.data?.error || 'Failed to delete this template version.', 'error');
        } finally {
          setUploadingTemplate(false);
        }
      }
    });
  };

  const handleRestoreVersion = (v) => {
    setConfirmModal({
      isOpen: true,
      title: `Restore Version ${v.version}?`,
      message: `Make version ${v.version} (${v.filename}, uploaded ${v.uploadedAt ? new Date(v.uploadedAt).toLocaleString() : 'earlier'}) the active template again? New proposals will be generated from it.`,
      confirmText: 'Yes, Restore This Version',
      cancelText: 'Keep Current Template',
      variant: 'warning',
      icon: <RotateCcw size={24} color="#d97706" />,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        try {
          setUploadingTemplate(true);
          await axios.post(`/api/proposals/templates/${v.id}/activate`);
          showToast(`Template version ${v.version} is now the active template.`);
          fetchTemplateInfo();
          window.dispatchEvent(new Event('proposal-template-changed')); // the editor's logo card re-reads the template info
        } catch (err) {
          showToast(err.response?.data?.error || 'Failed to restore this template version.', 'error');
        } finally {
          setUploadingTemplate(false);
        }
      }
    });
  };

  const handleStartFreshProposal = () => {
    setSelectedProposal(null);
    setViewOnly(false);
    try {
      localStorage.removeItem('insightHub_activeProposalSession');
      sessionStorage.removeItem('insightHub_activeProposalTabSession');
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
          await axios.delete(`/api/proposals/saved/${id}`, { headers: { 'x-user-email': userEmail } }); // the backend checks who is deleting
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
      // The Word / PDF of the CURRENT step (built from its content snapshot the first time if it is not stored yet)
      const { blob, fileName } = await downloadProposalStepFile(proposal.id, format, undefined, userEmail);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showToast(`${format.toUpperCase()} downloaded successfully!`);
    } catch (err) {
      console.error('Export error:', err);
      let reason = '';
      try { const body = err.response && err.response.data; reason = (body instanceof Blob ? JSON.parse(await body.text()) : body || {}).error || ''; } catch { /* no reason available */ }
      showToast(reason || `Failed to export ${format.toUpperCase()}.`, 'error');
    } finally {
      setExportingId(null);
    }
  };

  // Opens a saved proposal in the editor (solution proposals have their own page)
  const handleEditProposal = item => {
    setViewOnly(false);
    if (item.proposalType === 'solution') {
      navigate(`/proposals/solution?ref=${encodeURIComponent(item.id)}`);
      return;
    }
    if (item.proposalType === 'productSolution') {
      navigate(`/proposals/product-solution?ref=${encodeURIComponent(item.id)}`);
      return;
    }
    setSelectedProposal(item);
    handleTabChange('generator');
  };

  // View (Confirmed / Completed): the same screens as Edit, read-only (solution proposals have their own pages and read their status themselves)
  const handleViewProposal = item => {
    if (item.proposalType === 'solution' || item.proposalType === 'productSolution') return handleEditProposal(item);
    setSelectedProposal(item);
    setViewOnly(true);
    handleTabChange('generator');
  };

  // Back from a read-only view: the archive, with the same row still expanded
  const handleViewBack = () => {
    setSelectedProposal(null);
    setViewOnly(false);
    handleTabChange('archive');
  };

  // The editor saved an edit (a content change = a new version): refresh that row. selectedProposal is left alone so the editor is not reset.
  const handleProposalSaved = saved => {
    setSavedProposals(prev => prev.map(p => (p.id === saved.id ? { ...p, ...saved } : p)));
  };

  // Keep the row in sync after the expanded panel saved a status / uploaded a document
  const handleStatusChanged = (refNo, status, statusHistory) => {
    setSavedProposals(prev => prev.map(p => (p.id === refNo ? { ...p, status, statusHistory } : p)) /* refNo here is the proposal id */);
  };

  const filteredProposals = savedProposals.filter(p => {
    const q = proposalSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      statusOf(p).toLowerCase().includes(q) ||
      (p.proposalType === 'solution' ? 'solution' : (p.proposalType === 'productSolution' ? 'product + solution' : 'product')).includes(q) ||
      (p.companyName && p.companyName.toLowerCase().includes(q)) ||
      (p.refNo && p.refNo.toLowerCase().includes(q)) ||
      allRefsOf(p).some(r => r.toLowerCase().includes(q)) || // the base reference and every <base>-Vn
      ((p.fields && p.fields.refNo) && String(p.fields.refNo).toLowerCase().includes(q)) ||
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

      {/* Top Header (shared with the Solution and Product + Solution pages) */}
      <ProposalHubHeader activeTab={activeTab} onTab={tab => { if (tab === 'generator') setSelectedProposal(null); if (tab === 'archive') fetchSavedProposals(); handleTabChange(tab); }} count={savedProposals.length} showGenerate={!archiveOnly} showTemplate={isAdmin && !archiveOnly} />

      {/* Main Content Area */}
      <main className="proposal-hub-main" style={{ flex: 1, padding: activeTab === 'generator' ? '20px 24px' : '32px 36px', maxWidth: activeTab === 'generator' ? '100%' : '1350px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        
        {/* TAB 1: Proposal Generator Wizard */}
        <div style={{ display: activeTab === 'generator' ? 'block' : 'none' }}>
          {(
            <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', padding: '20px 16px' }}>
              {selectedProposal && !viewOnly && (
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
                onSaved={handleProposalSaved}
                viewOnly={viewOnly}
                onViewBack={handleViewBack}
                onProposalGenerated={() => {
                  fetchSavedProposals();
                }}
              />
            </div>
          )}
        </div>

        {/* TAB 2: Upload Latest Template (Admin Only) */}
        {isAdmin && activeTab === 'template' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {[['product', 'Product template'], ['solution', 'Solution template'], ['productSolution', 'Product + Solution template']].map(([t, text]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTemplateType(t)}
                style={{
                  padding: '8px 18px', borderRadius: 8, fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                  border: templateType === t ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                  background: templateType === t ? '#e0f2fe' : '#ffffff',
                  color: templateType === t ? '#0369a1' : '#64748b'
                }}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {isAdmin && activeTab === 'template' && templateType === 'solution' && (
          <SolutionTemplatePanel userEmail={userEmail} showToast={showToast} />
        )}
        {isAdmin && activeTab === 'template' && templateType === 'productSolution' && (
          <ProductSolutionTemplatePanel userEmail={userEmail} showToast={showToast} />
        )}
        {isAdmin && activeTab === 'template' && templateType === 'product' && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0B2A6F', margin: '0 0 6px' }}>Upload Latest Proposal Template</h2>
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                All future proposals generated by InsightHub will use the latest template you upload here. InsightHub finds where each proposal field belongs, writes the fill-in tags into a copy, cleans it and makes it the active template in one step. Your uploaded file is kept unchanged, and older versions can be restored.
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
                    Your Upload Is Kept Exactly As It Is
                  </div>
                  <div>
                    The <strong>.docx</strong> you upload is stored <strong>exactly as uploaded</strong>. A separate copy with the fill-in tags is made from it, keeping your formatting.
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
                          `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB ready to analyse`
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
                        <RefreshCw size={18} className="spin" /> Analysing Template...
                      </>
                    ) : (
                      <>
                        <Upload size={18} /> Analyse Template (.docx)
                      </>
                    )}
                  </button>
                </form>

                {/* Result of the last upload: the version; a warning only when something needs attention */}
                {uploadResult && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ padding: '12px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0', fontSize: '0.84rem', color: '#166534', lineHeight: 1.5 }}>
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CheckCircle2 size={16} color="#16a34a" /> Template version {uploadResult.version} is now the active template
                      </div>
                    </div>
                    {(uploadResult.unconnectedRed > 0 || uploadResult.aiError) && (
                      <div style={{ marginTop: 8, padding: '12px 14px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a', fontSize: '0.83rem', color: '#92400e', lineHeight: 1.5 }}>
                        <div style={{ fontWeight: 700 }}>Please check the first proposal you generate:</div>
                        {uploadResult.aiError && <div>The AI field matching did not run ({uploadResult.aiError}); only tags already in the file were used.</div>}
                        {uploadResult.unconnectedRed > 0 && <div>{uploadResult.unconnectedRed} piece(s) of red sample text were not connected to any field and will print as they are.</div>}
                      </div>
                    )}
                  </div>
                )}

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

                  {/* Previous versions: restoring one makes it the active template again */}
                  {templateVersions.some(v => !v.isActive) && (
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Previous versions</div>
                      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {templateVersions.filter(v => !v.isActive).map(v => (
                          <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0B2A6F' }}>Version {v.version} &nbsp;•&nbsp; {v.filename}</div>
                              <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{v.uploadedAt ? new Date(v.uploadedAt).toLocaleString() : ''}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => handleRestoreVersion(v)}
                              disabled={uploadingTemplate}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: '#f8fafc', color: '#475569', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.8rem', fontWeight: 600, cursor: uploadingTemplate ? 'not-allowed' : 'pointer' }}
                              title={`Make version ${v.version} the active template again`}
                            >
                              <RotateCcw size={13} /> Restore
                            </button>
                            <button type="button" disabled={uploadingTemplate} onClick={() => handleDeleteVersion(v)} title={`Delete version ${v.version} permanently`}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: '#fef2f2', color: '#dc2626', borderRadius: 6, border: '1px solid #fecaca', fontSize: '0.8rem', fontWeight: 600, cursor: uploadingTemplate ? 'not-allowed' : 'pointer' }}>
                              <Trash2 size={13} /> Delete
                            </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Architecture Note */}
                <div style={{ marginTop: 16, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.8rem', color: '#334155', lineHeight: 1.5 }}>
                  <strong>Zero-Conversion Guarantee:</strong> Uploading native <strong>.docx</strong> templates ensures <strong>zero conversion</strong> is performed, keeping 100% of your tables, page breaks, fonts, and vector logos exactly as designed.
                </div>
              </div>

              {/* Tag Cheatsheet Card */}
              <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 10px', color: '#0B2A6F', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 size={20} color="#10b981" /> Best Method to Mark Changing Points in the Template
                </h3>
                <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>
                  The standard method for Word templates is <strong>docxtemplater mustache tags: <code>{'{tag}'}</code></strong>.
                </p>

                {/* 3 Core Principles */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 16 }}>
                  <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.82rem', lineHeight: 1.5 }}>
                    <strong style={{ color: '#0B2A6F' }}>• How Word Treats Tags:</strong> Tags are standard text in Word (<code>.docx</code>). Microsoft Word preserves all font styling (color, size, bold, italics, font family) applied to the <code>{'{tag}'}</code>.
                  </div>
                  <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.82rem', lineHeight: 1.5 }}>
                    <strong style={{ color: '#0B2A6F' }}>• Visual Highlighting in Word:</strong> To make changing points easily identifiable when viewing the document in Microsoft Word, you can highlight the tag text using Word's yellow highlighter or give the tag text a specific font color. The replacement engine will insert the actual business values while keeping your formatting.
                  </div>
                  <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: '0.82rem', lineHeight: 1.5 }}>
                    <strong style={{ color: '#0B2A6F' }}>• Dual Logo Header:</strong> In Word, insert a borderless 1-row, 2-column table at the top of page 1:
                    <div style={{ marginTop: 4, paddingLeft: 12 }}>
                      &bull; <strong>Left Column:</strong> Paste the official SLT-Mobitel Enterprise logo.<br />
                      &bull; <strong>Right Column:</strong> Insert <code>{'{companyName}'}</code> or leave space for the lead's corporate logo.
                    </div>
                  </div>
                </div>

                <div style={{ padding: '8px 12px', background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe', color: '#1e40af', fontSize: '0.8rem', marginBottom: 14 }}>
                  <strong>Strict Non-Destructive Guarantee:</strong> InsightHub only substitutes marked placeholders with live lead & user details. It will not alter widths, points, row heights, margins, formats, or images in your uploaded template.
                </div>

                <h4 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 8px', color: '#0B2A6F' }}>Key Placeholder Tags Reference</h4>
                <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px', color: '#475569', width: '42%' }}>Placeholder in Word</th>
                        <th style={{ padding: '8px 12px', color: '#475569' }}>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{companyName}'}</td>
                        <td style={{ padding: '8px 12px' }}>Customer / Lead enterprise name</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{refNo}'}</td>
                        <td style={{ padding: '8px 12px' }}>Unique Proposal Reference Number (<code>SLT-xxxxxxxxx</code>)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{proposalDate}'}</td>
                        <td style={{ padding: '8px 12px' }}>Formatted issue date (e.g. <code>23 OCT 2026</code>)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{recipientDesignation}'}</td>
                        <td style={{ padding: '8px 12px' }}>Addressee title (e.g. <code>General Manager</code>, <code>IT Director</code>)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{address}'}</td>
                        <td style={{ padding: '8px 12px' }}>Company registered street and city address</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{%client_logo}'}</td>
                        <td style={{ padding: '8px 12px' }}>Client company logo (centre the line to centre the logo)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{@letterXml}'}</td>
                        <td style={{ padding: '8px 12px' }}>Tailored cover letter paragraphs written by n8n AI</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{@requirementsXml}'}</td>
                        <td style={{ padding: '8px 12px' }}>Network diagrams and technical bullet points</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{@aboutXml}'}</td>
                        <td style={{ padding: '8px 12px' }}>Customer company overview and recommended products</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{#productTerms} {number}. {name} / {terms} {/productTerms}'}</td>
                        <td style={{ padding: '8px 12px' }}>Optional. One numbered title and the terms paragraph for each selected product that has terms, in the template's own styles. Each loop tag alone in its own paragraph. Not added automatically. (Older: <code>{'{@productTermsXml}'}</code>, all product terms as one bullet list.)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{#components} ... {/components}'}</td>
                        <td style={{ padding: '8px 12px' }}>Dynamic table rows for Proposed Solutions (Service, Station, Media, NTU)</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{#investment} ... {/investment}'}</td>
                        <td style={{ padding: '8px 12px' }}>Dynamic table rows for Investment & Pricing</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#0284c7' }}>{'{amName}'}, {'{amPhone}'}, {'{amEmail}'}</td>
                        <td style={{ padding: '8px 12px' }}>Sales Representative / Account Manager contact details</td>
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
              onClick={() => {
                setSelectedProposal(null);
                handleTabChange('generator');
              }}
                  style={{ padding: '8px 18px', background: '#0284c7', color: '#ffffff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  Generate First Proposal
                </button>
              </div>
            ) : (
              <div className="table-responsive" style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', overflowX: 'auto', WebkitOverflowScrolling: 'touch', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                <table style={{ width: '100%', minWidth: '920px', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
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
                      <React.Fragment key={item.id || idx}>
                      <tr style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s ease' }} onMouseOver={e => e.currentTarget.style.background = '#f8fafc'} onMouseOut={e => e.currentTarget.style.background = '#ffffff'}>
                        <td style={{ padding: '14px 18px', fontFamily: 'monospace', fontWeight: 700, color: '#0369a1', minWidth: 170, maxWidth: 260, wordBreak: 'break-all' }}>
                          {item.proposalType === 'solution' || item.proposalType === 'productSolution' ? item.refNo : ((item.fields && item.fields.refNo) || item.refNo)}
                          <span style={{ display: 'table', marginTop: 4, fontFamily: 'Inter, sans-serif', fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: item.proposalType === 'solution' ? '#ede9fe' : (item.proposalType === 'productSolution' ? '#dcfce7' : '#e0f2fe'), color: item.proposalType === 'solution' ? '#6d28d9' : (item.proposalType === 'productSolution' ? '#166534' : '#0369a1') }}>
                            {item.proposalType === 'solution' ? 'Solution' : (item.proposalType === 'productSolution' ? 'Product + Solution' : 'Product')}
                          </span>
                          {(() => { const cur = currentStepOf(item); return cur ? (
                            <span title="Current step" style={{ display: 'table', marginTop: 4, fontFamily: 'Inter, sans-serif', fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#f1f5f9', color: '#475569' }}>
                              {stepName(cur)}
                            </span>
                          ) : null; })()}
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
                            {/* Confirmed / Completed proposals are view-only: View takes the place of Edit */}
                            <button
                              onClick={() => (rowActionOf(item) === 'View' ? handleViewProposal(item) : handleEditProposal(item))}
                              title={rowActionOf(item) === 'View' ? 'View (read-only)' : 'Open in Document Editor'}
                              style={{ padding: '5px 9px', borderRadius: 6, background: '#eff6ff', color: '#0284c7', border: '1px solid #bfdbfe', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 700 }}
                            >
                              <Eye size={13} /> {rowActionOf(item)}
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

                            {canDelete && (
                              <button
                                onClick={() => handleDeleteProposal(item.id, item.refNo)}
                                title="Delete Proposal"
                                style={{ padding: '5px 8px', borderRadius: 6, background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca', cursor: 'pointer' }}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}

                            <button
                              onClick={() => setExpandedRef(prev => (prev === (item.refNo || item.id) ? null : (item.refNo || item.id)))}
                              aria-expanded={expandedRef === (item.refNo || item.id)}
                              aria-controls={`proposal-panel-${item.id}`}
                              title={expandedRef === (item.refNo || item.id) ? 'Hide version history' : 'Show version history & status'}
                              aria-label={expandedRef === (item.refNo || item.id) ? 'Hide version history' : 'Show version history and status'}
                              style={{ padding: '5px 8px', borderRadius: 6, background: '#f8fafc', color: '#475569', border: '1px solid #cbd5e1', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            >
                              <ChevronDown size={13} style={{ transition: 'transform 0.2s ease', transform: expandedRef === (item.refNo || item.id) ? 'rotate(180deg)' : 'none' }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedRef === (item.refNo || item.id) && (
                        <tr id={`proposal-panel-${item.id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td colSpan={7} style={{ padding: 0 }}>
                            <div style={{ width: 0, minWidth: '100%' }}>
                              <ProposalStatusPanel key={item.refNo || item.id} proposal={item} userEmail={userEmail} onChanged={handleStatusChanged} onEdit={() => handleEditProposal(item)} showToast={showToast} />
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
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

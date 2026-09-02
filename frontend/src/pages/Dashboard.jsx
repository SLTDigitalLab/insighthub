import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LogOut, Users, Briefcase, FileText, Package, Download, Loader2, AlertCircle, ChevronRight, Mail, Star, Phone, ExternalLink, CheckCircle, UploadCloud, X, Database, Trash2, Layers, Sparkles, Compass, Filter, ShieldCheck } from 'lucide-react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { WEBHOOK_URLS } from '../config';
import {
  uploadKnowledgeBaseDocument,
  fetchKnowledgeBaseDocuments,
  deleteKnowledgeBaseDocument,
  searchKnowledgeBaseVectors,
  fetchProductRecommendations,
  fetchMeetingPreparation,
  fetchLeadDiscovery,
  fetchFindNewBusinesses,
  fetchCustomerResearch,
  fetchHelpImproveService,
  fetchAllSearchResults,
  sendResultsEmail
} from '../api';


const agents = [
  {
    id: 'allResults',
    name: 'All Search Results (All Scores)',
    icon: Compass,
    desc: 'Unfiltered lead search showing ALL discovered businesses, hotels, and companies across Sri Lanka (High, Medium, and Low scores included).',
    placeholder: 'e.g. "hotels in kandy", "travel agencies in galle", "software companies in colombo"',
    color: '#6366f1'
  },
  {
    id: 'lead',
    name: 'Lead Discovery & Prospecting',
    icon: Users,
    desc: 'Find newly registered businesses and discover companies by industry, location, and size.',
    placeholder: 'e.g. "Find tech startups in Colombo" or "Banking companies in Sri Lanka"',
    color: '#0066FF'
  },
  {
    id: 'newBusinesses',
    name: 'Find New Businesses',
    icon: Sparkles,
    desc: 'Discover newly registered companies from Sunday Observer monthly lists and match with SLTMobitel B2B solutions.',
    placeholder: 'e.g. "Find newly registered logistics companies in Colombo" or "List new businesses registered this month"',
    color: '#06b6d4'
  },
  {
    id: 'research',
    name: 'Customer Research',
    icon: Briefcase,
    desc: 'Get company profiles, key decision-makers, employees, and social media presence.',
    placeholder: 'e.g. "Research John Keells Holdings" or "Tell me about Hayleys PLC"',
    color: '#8b5cf6'
  },
  {
    id: 'meeting',
    name: 'Meeting Preparation',
    icon: FileText,
    desc: 'Generate company insights, discussion points, and potential pain points.',
    placeholder: 'e.g. "Prepare me for a meeting with Commercial Bank of Ceylon"',
    color: '#f59e0b'
  },
  {
    id: 'product',
    name: 'Product Recommendations',
    icon: Package,
    desc: 'Identify additional services to offer and product bundling suggestions.',
    placeholder: 'e.g. "Recommend products for a bank with 20 branches needing better connectivity"',
    color: '#10b981'
  },
  {
    id: 'improve',
    name: 'Help Improve Service',
    icon: Star,
    desc: 'Analyze Google and Facebook reviews to suggest service improvements and find employees.',
    placeholder: 'e.g. "Analyze reviews for Dialog Axiata and find employees"',
    color: '#ec4899'
  }
];

const StarRating = ({ rating }) => {
  const numRating = parseFloat(rating);
   if (isNaN(numRating)) {
    return (
      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem' }}>
        N/A
      </span>
    );
  }
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(numRating)) {
      stars.push(<span key={i} style={{ color: '#f59e0b', fontSize: '0.95rem' }}>★</span>);
    } else if (i === Math.ceil(numRating) && numRating % 1 !== 0) {
      stars.push(<span key={i} style={{ color: '#f59e0b', opacity: 0.7, fontSize: '0.95rem' }}>★</span>);
    } else {
      stars.push(<span key={i} style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.95rem' }}>★</span>);
    }
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(245, 158, 11, 0.08)', padding: '0.2rem 0.6rem', borderRadius: '0.5rem', border: '1px solid rgba(245, 158, 11, 0.2)', whiteSpace: 'nowrap' }}>
      <div style={{ display: 'flex', gap: '1px' }}>{stars}</div>
      <span style={{ fontWeight: 700, color: '#f59e0b', fontSize: '0.85rem' }}>{numRating.toFixed(1)}</span>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>(Google Review)</span>
    </div>
  );
};

const SOURCE_COLORS = {
  'Knowledge Base': { bg: '#10b98120', text: '#10b981' },
  'Review Analysis': { bg: '#f59e0b20', text: '#f59e0b' },
  'Both': { bg: '#3b82f620', text: '#3b82f6' }
};

const SourceBadge = ({ source }) => {
  const style = SOURCE_COLORS[source] || SOURCE_COLORS['Knowledge Base'];
  return (
    <span style={{
      padding: '0.2rem 0.65rem',
      borderRadius: '1rem',
      fontSize: '0.75rem',
      fontWeight: 'bold',
      background: style.bg,
      color: style.text,
      whiteSpace: 'nowrap'
    }}>
      {source || 'Knowledge Base'}
    </span>
  );
};

const PRIORITY_COLORS = {
  High: { bg: '#ef444420', text: '#ef4444' },
  Medium: { bg: '#f59e0b20', text: '#f59e0b' },
  Low: { bg: '#6b728020', text: '#9ca3af' }
};

const PriorityBadge = ({ priority }) => {
  const style = PRIORITY_COLORS[priority] || PRIORITY_COLORS['Low'];
  return (
    <span style={{
      padding: '0.25rem 0.75rem',
      borderRadius: '1rem',
      fontSize: '0.8rem',
      fontWeight: '700',
      background: style.bg,
      color: style.text
    }}>
      {priority}
    </span>
  );
};

const KNOWN_LABELS = [
  'Problem Solved',
  'Key Features',
  'Expected Value',
  'Why Recommended',
  'Core Features',
  'Sales Pitch Question',
  'Expected ROI & Value'
];

const renderFormattedText = (rawText, accentColor = '#6366f1') => {
  if (typeof rawText !== 'string') return rawText;

  const lines = rawText
    .split(/(?:\r?\n|(?=\d+\.\s+\*\*))/g)
    .filter(Boolean)
    .filter(line => /[a-zA-Z0-9]/.test(line.trim())); // drop stray separator-only lines (---, ___, ***, —, •, etc.)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {lines.map((lineText, lineIdx) => {
        const trimmed = lineText.trim();
        const isNewProduct = /^\d+\.\s+\*\*/.test(trimmed);

        const renderLineContent = (str) => {
          // Detect a leading "Label:" as plain text (no ** needed) and force it bold white
          const labelMatch = KNOWN_LABELS
            .map(label => ({ label, re: new RegExp(`^(${label}:)\\s*`) }))
            .find(({ re }) => re.test(str));

          let prefix = null;
          let rest = str;
          if (labelMatch) {
            const m = str.match(labelMatch.re);
            prefix = m[1];
            rest = str.slice(m[0].length);
          }

          const parts = rest.split(/(\*\*[^*]+\*\*)/g);
          const renderedRest = parts.map((part, pIdx) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              const boldContent = part.slice(2, -2);
              const isSubLabel = boldContent.trim().endsWith(':');
              return (
                <strong
                  key={pIdx}
                  style={{
                    color: isSubLabel ? '#ffffff' : accentColor,
                    fontWeight: 700
                  }}
                >
                  {boldContent}
                </strong>
              );
            }

            const urlRegex = /((?:https?:\/\/|www\.|linkedin\.com|facebook\.com)[^\s]+)/g;
            const urlParts = part.split(urlRegex);
            return urlParts.map((subPart, uIdx) => {
              if (subPart.match(urlRegex)) {
                let href = subPart;
                let suffix = '';
                if (href.endsWith(')') && !href.includes('(')) {
                  suffix = ')';
                  href = href.slice(0, -1);
                } else if (href.endsWith('.') || href.endsWith(',')) {
                  suffix = href.slice(-1);
                  href = href.slice(0, -1);
                }
                let displayHref = href;
                if (!href.startsWith('http')) href = 'https://' + href;
                return (
                  <React.Fragment key={uIdx}>
                    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'underline' }}>
                      {displayHref}
                    </a>
                    {suffix}
                  </React.Fragment>
                );
              }
              return subPart;
            });
          });

          return (
            <>
              {prefix && <strong style={{ color: '#ffffff', fontWeight: 700 }}>{prefix} </strong>}
              {renderedRest}
            </>
          );
        };

        return (
          <React.Fragment key={lineIdx}>
            {isNewProduct && lineIdx > 0 && (
              <hr
                style={{
                  border: 'none',
                  borderTop: '1px solid var(--border-color)',
                  margin: '0.5rem 0'
                }}
              />
            )}
            <div style={{ lineHeight: '1.6' }}>
              {renderLineContent(trimmed)}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const renderTextWithLinks = (text, accentColor) => renderFormattedText(text, accentColor);

const FAILURE_PHRASES = [
  'no verified',
  'not found via available search',
  'usage-limit error',
  'search tool calls failed',
  'could not be produced',
  'could not be compiled',
  'could not be identified'
];

const isLikelyFailedResult = (resultsArray) => {
  if (!resultsArray || resultsArray.length === 0) return false;
  const textFields = resultsArray.map(row => {
    const values = Object.values(row).filter(v => typeof v === 'string');
    return values.join(' ').toLowerCase();
  });
  const failedCount = textFields.filter(text =>
    FAILURE_PHRASES.some(phrase => text.includes(phrase))
  ).length;
  return failedCount >= Math.ceil(resultsArray.length / 2);
};

const Dashboard = () => {
  const [activeAgent, setActiveAgent] = useState(agents[0]);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [emailSending, setEmailSending] = useState(false);

  const [showKBModal, setShowKBModal] = useState(false);
  const [kbDocuments, setKbDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [vectorSearchQuery, setVectorSearchQuery] = useState('');
  const [vectorSearchResults, setVectorSearchResults] = useState(null);
  const [searchingVector, setSearchingVector] = useState(false);

  const loadKbDocuments = async () => {
    setLoadingDocs(true);
    try {
      const data = await fetchKnowledgeBaseDocuments();
      if (data && data.documents) {
        setKbDocuments(data.documents);
      }
    } catch (err) {
      console.warn("Could not fetch local knowledge base documents:", err.message);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    if (showKBModal) {
      loadKbDocuments();
    }
  }, [showKBModal]);

  const handleFileUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      await uploadKnowledgeBaseDocument(selectedFile, (progress) => {
        setUploadProgress(progress);
      });
      showToast(`Successfully uploaded "${selectedFile.name}" and indexed to ChromaDB!`, 'success');
      setSelectedFile(null);
      loadKbDocuments();
    } catch (err) {
      console.error("Local KB upload error:", err);
      showToast(err.response?.data?.error || err.message || 'Failed to upload document to Local Knowledge Base.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete "${name}" from local storage and vector store?`)) return;
    try {
      await deleteKnowledgeBaseDocument(id);
      showToast(`Deleted "${name}"`, 'success');
      loadKbDocuments();
    } catch (err) {
      showToast('Failed to delete document', 'error');
    }
  };

  const handleVectorSearch = async (e) => {
    e.preventDefault();
    if (!vectorSearchQuery) return;
    setSearchingVector(true);
    try {
      const data = await searchKnowledgeBaseVectors(vectorSearchQuery);
      setVectorSearchResults(data.results);
    } catch (err) {
      showToast('Vector search error: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setSearchingVector(false);
    }
  };

  const [toast, setToast] = useState(null);
  const [scoreFilter, setScoreFilter] = useState('all');
  const [tableSearch, setTableSearch] = useState('');
  const navigate = useNavigate();
  const userEmail = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
  const isAdmin =
    localStorage.getItem('insightHub_adminAuth') === 'true' ||
    localStorage.getItem('userRole') === 'admin' ||
    userEmail.includes('dinesh') ||
    userEmail.includes('020601') ||
    userEmail.includes('lahirus') ||
    userEmail.includes('shalikahathurusinghe') ||
    userEmail.includes('admin');

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleLogout = () => {
    localStorage.removeItem('userEmail');
    navigate('/login');
  };

  const handleSearch = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!prompt) return;

    setLoading(true);
    setResults(null);
    setError(null);
    setScoreFilter('all');
    setTableSearch('');

    try {
      console.log(`[InsightHub Gateway] Requesting live n8n AI Agent for "${activeAgent.name}" with prompt: "${prompt}"`);

      let responseData = null;

      if (activeAgent.id === 'allResults') {
        responseData = await fetchAllSearchResults(prompt);
      } else if (activeAgent.id === 'lead') {
        responseData = await fetchLeadDiscovery(prompt);
      } else if (activeAgent.id === 'newBusinesses') {
        responseData = await fetchFindNewBusinesses(prompt);
      } else if (activeAgent.id === 'research') {
        responseData = await fetchCustomerResearch(prompt);
      } else if (activeAgent.id === 'product') {
        responseData = await fetchProductRecommendations(prompt);
      } else if (activeAgent.id === 'meeting') {
        responseData = await fetchMeetingPreparation(prompt);
      } else if (activeAgent.id === 'improve') {
        responseData = await fetchHelpImproveService(prompt);
      }

      if (responseData && responseData.results && Array.isArray(responseData.results)) {
        setResults(responseData.results);
      } else if (Array.isArray(responseData)) {
        setResults(responseData);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error('[Dashboard Search Error]', err);
      const rawError = err.response?.data?.error || err.response?.data?.message || err.message || '';
      if (rawError.includes('524') || err.response?.status === 524) {
        setError("n8n Cloud Webhook Timeout (524): n8n Cloud is running deep scrapers & knowledge base queries. The workflow is processing. Please wait a moment and click Search again.");
      } else {
        setError(
          rawError || `Failed to connect to live n8n ${activeAgent.name} Agent.`
        );
      }
    } finally {
      setLoading(false);
    }
  };


  const handleEmailResults = async () => {
    if (!results || !userEmail) return;
    setEmailSending(true);
    try {
      await sendResultsEmail({
        email: userEmail,
        subject: `InsightHub - ${activeAgent.name} Results`,
        agentName: activeAgent.name,
        results: results
      });
      showToast(`Results emailed successfully to ${userEmail}!`, 'success');
    } catch (err) {
      console.error('Email error:', err);
      const errMsg = err.response?.data?.error || err.message || 'Failed to send email. Check n8n SMTP settings.';
      showToast(errMsg, 'error');
    } finally {
      setEmailSending(false);
    }
  };

  const handleCompanyClick = (row) => {
    localStorage.setItem('selectedBusiness', JSON.stringify(row));
    const companyName = encodeURIComponent(row['Company Name']);
    window.open(`/business/${companyName}`, '_blank');
  };

  const exportToExcel = () => {
    if (!results) return;
    const worksheet = XLSX.utils.json_to_sheet(results);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, activeAgent.name.substring(0, 31));
    XLSX.writeFile(workbook, `Mobitel_${activeAgent.id}_results.xlsx`);
  };

  const exportToPDF = () => {
    if (!results || results.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(18);
    doc.setTextColor(59, 130, 246);
    doc.text('InsightHub - Mobitel Sales Intelligence', 14, 15);
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text(`${activeAgent.name} Report`, 14, 25);
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 32);

    const tableColumn = Object.keys(results[0]);
    const tableRows = results.map(row => tableColumn.map(col => String(row[col] || '')));

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 38,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: tableColumn.reduce((acc, col, i) => {
        if (['Details', 'Content', 'Why Recommended', 'Reason', 'Insights', 'Response', 'Key Decision Makers', 'Recommended Mobitel Products'].includes(col)) {
          acc[i] = { cellWidth: 'auto' };
        }
        return acc;
      }, {}),
    });

    doc.save(`Mobitel_${activeAgent.id}_report.pdf`);
  };

  const isLeadResults = Boolean(results && Array.isArray(results) && results.length > 0 && results[0] && results[0]['Company Name']);

  const highCount = isLeadResults ? (results || []).filter(r => r['Lead Score'] && (String(r['Lead Score']).includes('Hot') || String(r['Lead Score']).includes('High'))).length : 0;
  const medCount = isLeadResults ? (results || []).filter(r => r['Lead Score'] && String(r['Lead Score']).includes('Medium')).length : 0;
  const lowCount = isLeadResults ? (results || []).filter(r => r['Lead Score'] && String(r['Lead Score']).includes('Low')).length : 0;

  const displayedResults = isLeadResults ? (results || []).filter(row => {
    if (scoreFilter === 'High' && !(row['Lead Score'] && (String(row['Lead Score']).includes('Hot') || String(row['Lead Score']).includes('High')))) return false;
    if (scoreFilter === 'Medium' && !(row['Lead Score'] && String(row['Lead Score']).includes('Medium'))) return false;
    if (scoreFilter === 'Low' && !(row['Lead Score'] && String(row['Lead Score']).includes('Low'))) return false;

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      const name = (row['Company Name'] || '').toLowerCase();
      const loc = (row['Location'] || '').toLowerCase();
      const ind = (row['Industry'] || '').toLowerCase();
      const reason = (row['Reason'] || '').toLowerCase();
      return name.includes(q) || loc.includes(q) || ind.includes(q) || reason.includes(q);
    }
    return true;
  }) : results;

  const leadDisplayColumns = (isLeadResults && results[0] && (results[0]['Registration Details'] || results[0]['Recommended Mobitel Products']))
    ? ['Company Name', 'Registration Details', 'Industry', 'Location', 'Recommended Mobitel Products', 'Lead Score'].filter(col => results && results[0] && results[0][col] !== undefined)
    : (isLeadResults && results[0])
      ? ['Company Name', 'Industry', 'Size', 'Location', 'Contact Number', 'Customer Rating', 'Lead Score'].filter(col => results && results[0] && results[0][col] !== undefined)
      : ['Company Name', 'Industry', 'Size', 'Location', 'Contact Number', 'Customer Rating', 'Lead Score'];

  const showRetryBanner = Boolean(results && Array.isArray(results) && results.length > 0 && !loading && isLikelyFailedResult(results));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-color)' }}>
      {toast && (
        <div className={`toast ${toast.type}`}>
          <CheckCircle size={18} />
          {toast.message}
        </div>
      )}

      <div style={{
        width: '300px',
        background: '#ffffff',
        borderRight: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        boxShadow: '4px 0 20px rgba(0, 0, 0, 0.04)',
        zIndex: 10
      }}>
        <div style={{ padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', background: '#ffffff' }}>
          <div style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.25rem 0'
          }}>
            <img 
              src="/insighthub-logo.png" 
              alt="InsightHub Logo" 
              style={{ maxHeight: '100px', maxWidth: '250px', width: '100%', height: 'auto', objectFit: 'contain' }} 
            />
          </div>
          <p style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em', marginTop: '0.25rem' }}>
            SLT Mobitel
          </p>
        </div>

        <div style={{ padding: '1rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <p style={{ color: '#94a3b8', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0.25rem 0.75rem 0.5rem' }}>AI Agents</p>
          {agents.map(agent => {
            const Icon = agent.icon;
            const isActive = activeAgent.id === agent.id;
            return (
              <button
                key={agent.id}
                onClick={() => {
                  setActiveAgent(agent);
                  setResults(null);
                  setError(null);
                  setScoreFilter('all');
                  setTableSearch('');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  background: isActive ? 'linear-gradient(135deg, rgb(0, 102, 255) 0%, rgb(16, 185, 129) 100%)' : 'transparent',
                  color: isActive ? '#ffffff' : '#334155',
                  border: 'none',
                  borderRadius: '0.75rem',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  width: '100%',
                  fontSize: '0.88rem',
                  fontWeight: isActive ? '700' : '600',
                  boxShadow: isActive ? '0 4px 18px rgba(0, 102, 255, 0.35)' : 'none',
                  cursor: 'pointer'
                }}
                onMouseOver={(e) => {
                  if (!isActive) e.currentTarget.style.background = '#f1f5f9';
                }}
                onMouseOut={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <Icon size={18} color={isActive ? '#ffffff' : '#64748b'} />
                <span style={{ flex: 1 }}>{agent.name}</span>
                {isActive && <ChevronRight size={16} color="#ffffff" />}
              </button>
            );
          })}
        </div>


        <div style={{ padding: '1rem', borderTop: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.6rem', background: '#fafafa' }}>
          {userEmail && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#64748b', padding: '0.25rem 0' }}>
              <Mail size={14} color="#64748b" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{userEmail}</span>
            </div>
          )}

          {isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                color: '#0066FF',
                background: '#eff6ff',
                width: '100%',
                padding: '0.65rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                borderRadius: '0.65rem',
                border: '1.5px solid #bfdbfe',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 8px rgba(0, 102, 255, 0.08)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#dbeafe';
                e.currentTarget.style.borderColor = '#93c5fd';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 102, 255, 0.15)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = '#eff6ff';
                e.currentTarget.style.borderColor = '#bfdbfe';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 102, 255, 0.08)';
              }}
            >
              <ShieldCheck size={18} color="#0066FF" />
              <span style={{ flex: 1, textAlign: 'left' }}>Administrator Portal</span>
              <ChevronRight size={15} color="#0066FF" />
            </button>
          )}

          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              color: '#ef4444', background: 'transparent', width: '100%', padding: '0.5rem', fontSize: '0.88rem', fontWeight: 600,
              borderRadius: '0.5rem', transition: 'background 0.2s', border: 'none', cursor: 'pointer'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#fee2e2'}
            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <LogOut size={17} /> Logout
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div className="animate-fade-in" key={activeAgent.id} style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{
                width: '42px', height: '42px', borderRadius: '0.75rem',
                background: 'linear-gradient(135deg, rgb(0, 102, 255) 0%, rgb(16, 185, 129) 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 15px rgba(0, 102, 255, 0.25)'
              }}>
                <activeAgent.icon size={22} color="#ffffff" />
              </div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#0f172a' }}>{activeAgent.name}</h1>
            </div>
            <p style={{ color: 'var(--text-muted)', marginLeft: '3.25rem' }}>{activeAgent.desc}</p>
          </div>

          <button
            onClick={() => setShowKBModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              background: 'linear-gradient(135deg, #0066FF 0%, #10b981 100%)', color: 'white',
              padding: '0.75rem 1.4rem', borderRadius: '0.75rem', fontSize: '0.85rem', fontWeight: 'bold',
              boxShadow: '0 4px 18px rgba(0, 102, 255, 0.35)',
              border: 'none', cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            <Database size={16} /> Knowledge Base & Vector DB
          </button>
        </div>

        {activeAgent.id === 'newBusinesses' && (
          <div className="animate-fade-in" style={{
            maxWidth: '680px',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderLeft: '4px solid #0066FF',
            borderRadius: '0.85rem',
            padding: '0.75rem 1.15rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            boxShadow: '0 2px 12px rgba(0, 102, 255, 0.05)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '0.6rem',
                background: 'linear-gradient(135deg, rgba(0, 102, 255, 0.12) 0%, rgba(16, 185, 129, 0.12) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <Sparkles size={16} color="#0066FF" />
              </div>
              <div>
                <p style={{ fontWeight: '700', fontSize: '0.84rem', color: '#0f172a' }}>
                  Sunday Observer Registry Matcher
                </p>
                <p style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.1rem' }}>
                  Upload monthly company lists (PDF/Excel) to discover leads & match Mobitel products.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowKBModal(true)}
              className="btn-brand-gradient"
              style={{
                padding: '0.45rem 0.95rem',
                fontSize: '0.78rem',
                borderRadius: '0.6rem',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 10px rgba(0, 102, 255, 0.25)',
                flexShrink: 0
              }}
            >
              <UploadCloud size={14} /> Upload Registry
            </button>
          </div>
        )}

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={20} style={{ position: 'absolute', top: '50%', left: '1rem', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder={activeAgent.placeholder}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: '3rem',
                fontSize: '0.95rem',
                height: '52px',
                background: '#ffffff',
                color: '#0f172a',
                border: '1px solid #cbd5e1',
                borderRadius: '0.75rem',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)'
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !prompt}
            className="btn-brand-gradient"
            style={{
              height: '52px',
              padding: '0 2rem',
              fontSize: '0.95rem',
              whiteSpace: 'nowrap'
            }}
          >
            {loading ? <><Loader2 size={18} className="spin" /> Processing...</> : <><Search size={18} /> Search</>}
          </button>
        </form>

        {error && (
          <div className="animate-fade-in" style={{
            background: '#dc262615', border: '1px solid #dc262650', borderRadius: '0.75rem',
            padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem'
          }}>
            <AlertCircle size={20} color="#dc2626" />
            <p style={{ color: '#fca5a5' }}>{error}</p>
          </div>
        )}

        {loading && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem'
          }}>
            <div className="spin" style={{ width: '48px', height: '48px', border: `3px solid var(--border-color)`, borderTop: `3px solid ${activeAgent.color}`, borderRadius: '50%' }}></div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', textAlign: 'center' }}>
              ⚡ <strong>Live n8n AI Chat Agent</strong> is executing real-time web scraping & analysis...<br/>
              <span style={{ fontSize: '0.8rem', opacity: 0.75 }}>Fetching real-time business data via Apify & Mobitel Knowledge Base (this may take 20–60s)...</span>
            </p>
          </div>
        )}

        {showRetryBanner && (
          <div className="animate-fade-in" style={{
            background: '#f59e0b15', border: '1px solid #f59e0b50', borderRadius: '0.75rem',
            padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <AlertCircle size={20} color="#f59e0b" />
              <p style={{ color: '#fcd34d', fontSize: '0.9rem' }}>
                This search mostly returned no results — this can happen when search tools hit a temporary limit. Please try searching again.
              </p>
            </div>
            <button
              onClick={handleSearch}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: '#f59e0b', color: 'white',
                padding: '0.5rem 1.25rem', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: 'bold',
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap'
              }}
            >
              <Loader2 size={16} /> Try Again
            </button>
          </div>
        )}

        {results && results.length > 0 && !loading && (
          <div className="animate-fade-in" style={{
            background: '#ffffff',
            borderRadius: '1rem',
            padding: '1.5rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
            flex: 1,
            overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#0f172a', margin: 0 }}>
                  Results <span style={{ color: '#64748b', fontWeight: 'normal', fontSize: '0.85rem' }}>({results.length} total discovered)</span>
                </h3>
                {isLeadResults && scoreFilter !== 'all' && (
                  <span style={{ fontSize: '0.78rem', color: '#0066FF', fontWeight: 600 }}>
                    Showing {displayedResults.length} with {scoreFilter} Priority
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={handleEmailResults}
                  disabled={emailSending}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    background: '#6366f1', color: 'white',
                    padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: 'bold',
                    transition: 'opacity 0.2s',
                    opacity: emailSending ? 0.6 : 1
                  }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = emailSending ? '0.6' : '1'}
                >
                  {emailSending ? <Loader2 size={16} className="spin" /> : <Mail size={16} />}
                  {emailSending ? 'Sending...' : 'Email Results'}
                </button>
                <button
                  onClick={exportToExcel}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    background: '#059669', color: 'white',
                    padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: 'bold',
                    transition: 'opacity 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                >
                  <Download size={16} /> Export Excel
                </button>
                <button
                  onClick={exportToPDF}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    background: '#dc2626', color: 'white',
                    padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: 'bold',
                    transition: 'opacity 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                >
                  <Download size={16} /> Export PDF
                </button>
              </div>
            </div>

            {/* Score Filter Pills & Quick Table Search (for Lead Discovery & All Results) */}
            {isLeadResults && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                background: '#f8fafc',
                padding: '0.65rem 0.9rem',
                borderRadius: '0.75rem',
                border: '1px solid #e2e8f0',
                marginBottom: '1.25rem'
              }}>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginRight: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Filter size={13} /> Filter Score:
                  </span>
                  <button
                    type="button"
                    onClick={() => setScoreFilter('all')}
                    style={{
                      padding: '0.3rem 0.7rem',
                      borderRadius: '1rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: scoreFilter === 'all' ? '#0f172a' : '#e2e8f0',
                      color: scoreFilter === 'all' ? '#ffffff' : '#475569'
                    }}
                  >
                    All Scores ({results.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setScoreFilter('High')}
                    style={{
                      padding: '0.3rem 0.7rem',
                      borderRadius: '1rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: scoreFilter === 'High' ? '#10b981' : 'rgba(16, 185, 129, 0.12)',
                      color: scoreFilter === 'High' ? '#ffffff' : '#059669'
                    }}
                  >
                    🔥 High Priority ({highCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setScoreFilter('Medium')}
                    style={{
                      padding: '0.3rem 0.7rem',
                      borderRadius: '1rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: scoreFilter === 'Medium' ? '#f59e0b' : 'rgba(245, 158, 11, 0.12)',
                      color: scoreFilter === 'Medium' ? '#ffffff' : '#d97706'
                    }}
                  >
                    ⚡ Medium ({medCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setScoreFilter('Low')}
                    style={{
                      padding: '0.3rem 0.7rem',
                      borderRadius: '1rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      background: scoreFilter === 'Low' ? '#6366f1' : 'rgba(99, 102, 241, 0.12)',
                      color: scoreFilter === 'Low' ? '#ffffff' : '#4f46e5'
                    }}
                  >
                    🔹 Low ({lowCount})
                  </button>
                </div>

                <div style={{ position: 'relative', minWidth: '200px' }}>
                  <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type="text"
                    placeholder="Search company, city..."
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.35rem 0.75rem 0.35rem 2.2rem',
                      fontSize: '0.82rem',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '0.5rem',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: `2px solid #e2e8f0` }}>
                    {(isLeadResults ? leadDisplayColumns : Object.keys(results[0])).map(key => (
                      <th key={key} style={{
                        padding: '0.85rem 0.75rem',
                        color: activeAgent.color,
                        fontSize: '0.8rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        fontWeight: '700',
                        whiteSpace: 'nowrap'
                      }}>{key}</th>
                    ))}
                    {isLeadResults && (
                      <th style={{
                        padding: '0.85rem 0.75rem',
                        color: activeAgent.color,
                        fontSize: '0.8rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        fontWeight: '700',
                        whiteSpace: 'nowrap'
                      }}>Details</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {displayedResults.length === 0 ? (
                    <tr>
                      <td colSpan={(isLeadResults ? leadDisplayColumns.length + 1 : Object.keys(results[0]).length)} style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>
                        No results match the selected score filter or search query.
                        <button
                          onClick={() => { setScoreFilter('all'); setTableSearch(''); }}
                          style={{ marginLeft: '0.75rem', color: '#0066FF', background: 'transparent', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          Clear Filter
                        </button>
                      </td>
                    </tr>
                  ) : (
                    displayedResults.map((row, i) => (
                      <tr
                        key={i}
                        className={isLeadResults ? 'clickable-row' : ''}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background 0.15s'
                        }}
                        onClick={isLeadResults ? () => handleCompanyClick(row) : undefined}
                        onMouseOver={(e) => { if (!isLeadResults) e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseOut={(e) => { if (!isLeadResults) e.currentTarget.style.background = 'transparent'; }}
                      >
                        {(isLeadResults ? leadDisplayColumns : Object.keys(row)).map((col, j) => (
                          <td key={j} style={{
                            padding: '0.85rem 0.75rem',
                            fontSize: '0.9rem',
                            lineHeight: '1.5',
                            maxWidth: '400px',
                            color: '#334155'
                          }}>
                            {col === 'Customer Rating' ? (
                              <StarRating rating={row[col]} />
                            ) : col === 'Contact Number' ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#10b981', fontWeight: 500 }}>
                                <Phone size={14} />
                                {row[col] || 'N/A'}
                              </span>
                            ) : col === 'Lead Score' ? (
                              <span style={{
                                padding: '0.3rem 0.85rem',
                                borderRadius: '1rem',
                                fontSize: '0.8rem',
                                fontWeight: '700',
                                background: (row[col] && (row[col].includes('Hot') || row[col].includes('High'))) ? '#10b98120' : (row[col] && row[col].includes('Medium')) ? '#f59e0b20' : '#6366f120',
                                color: (row[col] && (row[col].includes('Hot') || row[col].includes('High'))) ? '#10b981' : (row[col] && row[col].includes('Medium')) ? '#f59e0b' : '#6366f1',
                                border: `1px solid ${(row[col] && (row[col].includes('Hot') || row[col].includes('High'))) ? '#10b98140' : '#6366f140'}`
                              }}>
                                {row[col]}
                              </span>
                            ) : col === 'Source' ? (
                              <SourceBadge source={row[col]} />
                            ) : col === 'Priority' && activeAgent.id === 'product' ? (
                              <PriorityBadge priority={row[col]} />
                            ) : (
                              renderTextWithLinks(row[col] || '', activeAgent.color)
                            )}
                          </td>
                        ))}
                        {isLeadResults && (
                          <td style={{ padding: '0.85rem 0.75rem' }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                              color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 600
                            }}>
                              View <ExternalLink size={14} />
                            </span>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}


        {(!results || results.length === 0) && !loading && !error && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', gap: '0.75rem', padding: '2rem', textAlign: 'center'
          }}>
            <activeAgent.icon size={48} style={{ opacity: 0.3, color: activeAgent.color }} />
            <p style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>
              {results && results.length === 0 ? `No scraped leads returned for "${prompt}"` : 'Enter a prompt above to get started'}
            </p>
            <p style={{ fontSize: '0.88rem', maxWidth: '480px', textAlign: 'center', lineHeight: 1.5 }}>
              {results && results.length === 0
                ? "The live n8n AI Agent finished its execution on n8n Cloud but scraped 0 items for this prompt. Try refining your query (e.g. 'private hospitals sri lanka' or 'hotels in kandy')."
                : "Connected to live n8n AI Agent gateway & local vector store."}
            </p>
          </div>
        )}
      </div>

      {showKBModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1.5rem'
        }}>
          <div style={{
            background: '#ffffff', border: '1px solid #e2e8f0',
            borderRadius: '1rem', width: '100%', maxWidth: '850px', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}>
            <div style={{
              padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#f8fafc'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Database size={22} color="#0066FF" />
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#0f172a' }}>Local Knowledge Base & Vector Store</h3>
                  <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Local storage & ChromaDB vector database index for n8n RAG workflows
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowKBModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.25rem' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              <div style={{
                border: '2px dashed #cbd5e1', borderRadius: '0.75rem',
                padding: '1.5rem', textAlign: 'center', background: '#f8fafc'
              }}>
                <UploadCloud size={36} style={{ color: '#0066FF', marginBottom: '0.5rem', opacity: 0.8 }} />
                <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#0f172a', marginBottom: '0.25rem' }}>Upload Document to Local Vector Store</h4>
                <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1rem' }}>
                  Supports PDF, Excel (.xlsx/.xls), CSV, Word (.docx), and TXT. Extracted text will be chunked and indexed automatically.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                  <input
                    type="file"
                    id="kb-file-input"
                    accept=".pdf,.txt,.docx,.csv,.json,.xlsx,.xls"
                    onChange={(e) => setSelectedFile(e.target.files[0])}
                    style={{ display: 'none' }}
                  />
                  <label
                    htmlFor="kb-file-input"
                    style={{
                      padding: '0.6rem 1.25rem', background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '0.5rem', fontSize: '0.85rem', cursor: 'pointer',
                      fontWeight: '500', color: '#0f172a',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}
                  >
                    {selectedFile ? selectedFile.name : 'Choose Local File'}
                  </label>

                  <button
                    onClick={handleFileUpload}
                    disabled={!selectedFile || uploading}
                    className="btn-brand-gradient"
                    style={{
                      padding: '0.6rem 1.25rem',
                      fontSize: '0.85rem',
                      opacity: selectedFile && !uploading ? 1 : 0.5,
                      cursor: selectedFile && !uploading ? 'pointer' : 'not-allowed'
                    }}
                  >
                    {uploading ? <><Loader2 size={16} className="spin" /> Indexing...</> : 'Upload & Vectorize'}
                  </button>
                </div>

                {uploading && (
                  <div style={{ marginTop: '1rem', width: '100%', background: '#e2e8f0', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${uploadProgress}%`, background: '#0066FF', height: '100%', transition: 'width 0.3s' }} />
                  </div>
                )}
              </div>

              <div style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '0.75rem', padding: '1rem' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: '600', color: '#3b82f6', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Layers size={16} /> Test Vector RAG Search (ChromaDB)
                </h4>
                <form onSubmit={handleVectorSearch} style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="Enter query to test vector embedding search (e.g. enterprise wifi products)"
                    value={vectorSearchQuery}
                    onChange={(e) => setVectorSearchQuery(e.target.value)}
                    style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                  />
                  <button
                    type="submit"
                    disabled={searchingVector || !vectorSearchQuery}
                    style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '0.5rem', padding: '0 1rem', fontSize: '0.85rem', fontWeight: '600' }}
                  >
                    {searchingVector ? <Loader2 size={14} className="spin" /> : 'Query Vector Store'}
                  </button>
                </form>

                {vectorSearchResults && (
                  <div style={{ marginTop: '0.75rem', maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {vectorSearchResults.documents && vectorSearchResults.documents[0] && vectorSearchResults.documents[0].length > 0 ? (
                      vectorSearchResults.documents[0].map((text, idx) => (
                        <div key={idx} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: '0.6rem', borderRadius: '0.5rem', fontSize: '0.8rem' }}>
                          <span style={{ color: '#10b981', fontWeight: 'bold', marginRight: '0.5rem' }}>Chunk #{idx + 1}:</span>
                          {text}
                        </div>
                      ))
                    ) : (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No matching vector chunks found.</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ fontSize: '1rem', fontWeight: '600' }}>Indexed Knowledge Base Documents ({kbDocuments.length})</h4>
                  <button
                    onClick={loadKbDocuments}
                    style={{ background: 'transparent', border: 'none', color: '#3b82f6', fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    Refresh List
                  </button>
                </div>

                {loadingDocs ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    <Loader2 size={24} className="spin" /> Loading documents...
                  </div>
                ) : kbDocuments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    No documents uploaded yet. Upload a PDF or TXT file above to get started.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto' }}>
                    {kbDocuments.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)',
                          border: '1px solid var(--border-color)', borderRadius: '0.5rem'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <FileText size={20} color="#3b82f6" />
                          <div>
                            <p style={{ fontSize: '0.9rem', fontWeight: '600' }}>{doc.name}</p>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {(doc.size / 1024).toFixed(1)} KB • {doc.chunkCount || 0} chunks • {new Date(doc.uploadedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span style={{
                            padding: '0.2rem 0.6rem', borderRadius: '1rem', fontSize: '0.7rem', fontWeight: 'bold',
                            background: doc.status === 'indexed_chroma' ? '#10b98120' : '#f59e0b20',
                            color: doc.status === 'indexed_chroma' ? '#10b981' : '#f59e0b'
                          }}>
                            {doc.status === 'indexed_chroma' ? 'Indexed (ChromaDB)' : 'Stored Locally'}
                          </span>
                          <button
                            onClick={() => handleDeleteDoc(doc.id, doc.name)}
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem' }}
                            title="Delete document"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', background: 'rgba(255,255,255,0.02)' }}>
              <button
                onClick={() => setShowKBModal(false)}
                style={{ padding: '0.5rem 1.25rem', background: 'var(--border-color)', color: 'var(--text-main)', border: 'none', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;
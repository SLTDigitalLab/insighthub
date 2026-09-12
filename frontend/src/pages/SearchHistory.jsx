import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Search,
  History,
  Trash2,
  Download,
  FileText,
  ExternalLink,
  Calendar,
  Sparkles,
  Users,
  Compass,
  Briefcase,
  Package,
  Star,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Mail,
  AlertCircle,
  Building2,
  Phone,
  MapPin,
  CheckCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  fetchUserSearchHistory,
  deleteSearchHistoryItem,
  clearAllSearchHistory
} from '../api';

const AGENT_ICONS = {
  allResults: Compass,
  lead: Users,
  newBusinesses: Sparkles,
  research: Briefcase,
  meeting: FileText,
  product: Package,
  improve: Star
};

const AGENT_COLORS = {
  allResults: '#6366f1',
  lead: '#0066FF',
  newBusinesses: '#06b6d4',
  research: '#8b5cf6',
  meeting: '#f59e0b',
  product: '#10b981',
  improve: '#ec4899'
};

const StarRating = ({ rating }) => {
  const numRating = parseFloat(rating);
  if (isNaN(numRating)) {
    return <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>N/A</span>;
  }
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(numRating)) {
      stars.push(<span key={i} style={{ color: '#f59e0b', fontSize: '0.88rem' }}>★</span>);
    } else if (i === Math.ceil(numRating) && numRating % 1 !== 0) {
      stars.push(<span key={i} style={{ color: '#f59e0b', opacity: 0.6, fontSize: '0.88rem' }}>★</span>);
    } else {
      stars.push(<span key={i} style={{ color: '#e2e8f0', fontSize: '0.88rem' }}>★</span>);
    }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
      {stars} <span style={{ fontSize: '0.78rem', color: '#64748b', marginLeft: '4px' }}>({numRating.toFixed(1)})</span>
    </span>
  );
};

const SearchHistory = () => {
  const navigate = useNavigate();
  const userEmail = (localStorage.getItem('userEmail') || '').toLowerCase().trim();
  
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState('all');
  const [expandedSearchId, setExpandedSearchId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserSearchHistory(userEmail);
      if (data && data.history) {
        setHistory(data.history);
      }
    } catch (err) {
      console.error('[Search History Fetch Error]', err);
      setError('Failed to load search history. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [userEmail]);

  const handleDelete = async (id, promptText) => {
    if (!window.confirm(`Are you sure you want to delete the saved search for "${promptText}"?`)) return;
    try {
      await deleteSearchHistoryItem(id, userEmail);
      setHistory(prev => prev.filter(item => item.id !== id));
      if (expandedSearchId === id) setExpandedSearchId(null);
      showToast('Search record deleted.', 'success');
    } catch (err) {
      console.error('[Delete Error]', err);
      showToast('Failed to delete search record.', 'error');
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to delete ALL your saved search history? This cannot be undone.')) return;
    try {
      await clearAllSearchHistory(userEmail);
      setHistory([]);
      setExpandedSearchId(null);
      showToast('All search history has been cleared.', 'success');
    } catch (err) {
      console.error('[Clear All Error]', err);
      showToast('Failed to clear search history.', 'error');
    }
  };

  const handleReRun = (item) => {
    // Navigate back to Dashboard with this search query
    navigate('/dashboard', {
      state: {
        reRunPrompt: item.prompt,
        reRunAgentId: item.agentId,
        cachedResults: item.results
      }
    });
  };

  const handleExportExcel = (item) => {
    try {
      const exportData = (item.results || []).map((row, idx) => ({
        '#': idx + 1,
        'Company Name': row['Company Name'] || row['Product'] || row['Section'] || 'N/A',
        'Industry': row['Industry'] || row['Category'] || 'N/A',
        'Size': row['Size'] || 'N/A',
        'Location': row['Location'] || 'N/A',
        'Contact Number': row['Contact Number'] || 'N/A',
        'Customer Rating': row['Customer Rating'] || 'N/A',
        'Lead Score': row['Lead Score'] || 'N/A',
        'Website': row['Website'] || 'N/A',
        'Reason / Sales Recommendation': row['Reason'] || row['Why Recommended'] || row['Details'] || row['Content'] || ''
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Discovered Leads');
      const filename = `InsightHub_${(item.prompt || 'Leads').replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.xlsx`;
      XLSX.writeFile(workbook, filename);
      showToast('Excel report downloaded successfully!', 'success');
    } catch (e) {
      console.error('Excel export error:', e);
      showToast('Failed to export Excel file.', 'error');
    }
  };

  const handleExportPDF = (item) => {
    try {
      const doc = new jsPDF('landscape');
      doc.setFontSize(16);
      doc.setTextColor(0, 102, 255);
      doc.text(`SLT-Mobitel InsightHub: ${item.agentName || 'Discovered Leads'}`, 14, 15);

      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(`Search Query: "${item.prompt}" | Date: ${new Date(item.timestamp).toLocaleString()} | Total Leads: ${item.resultsCount}`, 14, 22);

      const tableData = (item.results || []).map((row, idx) => [
        idx + 1,
        row['Company Name'] || row['Product'] || row['Section'] || 'N/A',
        row['Location'] || 'N/A',
        row['Contact Number'] || 'N/A',
        row['Customer Rating'] || 'N/A',
        row['Lead Score'] || 'N/A',
        (row['Reason'] || row['Why Recommended'] || row['Details'] || '').slice(0, 100) + '...'
      ]);

      autoTable(doc, {
        startY: 28,
        head: [['#', 'Company Name', 'Location', 'Phone', 'Rating', 'Score', 'Sales Justification']],
        body: tableData,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [0, 102, 255] }
      });

      doc.save(`InsightHub_${(item.prompt || 'Report').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
      showToast('PDF report downloaded successfully!', 'success');
    } catch (e) {
      console.error('PDF export error:', e);
      showToast('Failed to export PDF.', 'error');
    }
  };

  // Filter searches by keyword and agent type
  const filteredHistory = useMemo(() => {
    return history.filter(item => {
      const matchesSearch = !searchFilter ||
        item.prompt.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (item.agentName && item.agentName.toLowerCase().includes(searchFilter.toLowerCase()));
      
      const matchesAgent = selectedAgentFilter === 'all' || item.agentId === selectedAgentFilter;
      return matchesSearch && matchesAgent;
    });
  }, [history, searchFilter, selectedAgentFilter]);

  const totalLeadsSaved = useMemo(() => {
    return history.reduce((acc, curr) => acc + (curr.resultsCount || (curr.results ? curr.results.length : 0)), 0);
  }, [history]);

  const handleBack = () => {
    if (window.opener && !window.opener.closed) {
      window.close();
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, -apple-system, sans-serif' }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          background: toast.type === 'error' ? '#ef4444' : toast.type === 'success' ? '#10b981' : '#0066FF',
          color: '#ffffff',
          padding: '0.85rem 1.4rem',
          borderRadius: '0.75rem',
          boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          fontSize: '0.9rem',
          fontWeight: 600,
          animation: 'fadeIn 0.2s ease'
        }}>
          {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          {toast.message}
        </div>
      )}

      {/* Main Content Area */}
      <div style={{ flex: 1, padding: '2rem 3rem', maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        
        {/* Top Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={handleBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#ffffff',
                border: '1.5px solid #e2e8f0',
                padding: '0.65rem 1.1rem',
                borderRadius: '0.75rem',
                color: '#334155',
                fontSize: '0.88rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 6px rgba(0,0,0,0.03)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = '#0066FF';
                e.currentTarget.style.color = '#0066FF';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.color = '#334155';
              }}
            >
              <ArrowLeft size={16} /> Back to Dashboard
            </button>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '0.6rem',
                  background: 'linear-gradient(135deg, #0066FF 0%, #10b981 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(0, 102, 255, 0.25)'
                }}>
                  <History size={20} color="#ffffff" />
                </div>
                <h1 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  Search Results History
                </h1>
              </div>
              <p style={{ margin: '0.35rem 0 0 3.1rem', fontSize: '0.85rem', color: '#64748b' }}>
                Saved live web scrape leads & searches for <strong>{userEmail || 'User'}</strong>
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={loadHistory}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: '#ffffff',
                border: '1.5px solid #e2e8f0',
                padding: '0.65rem 1rem',
                borderRadius: '0.75rem',
                color: '#475569',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
            </button>

            {history.length > 0 && (
              <button
                onClick={handleClearAll}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: '#fef2f2',
                  border: '1.5px solid #fecaca',
                  padding: '0.65rem 1rem',
                  borderRadius: '0.75rem',
                  color: '#dc2626',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <Trash2 size={15} /> Clear All History
              </button>
            )}
          </div>
        </div>

        {/* Analytics / Metric Summary Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.25rem',
          marginBottom: '2rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '1rem',
            padding: '1.25rem 1.5rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <div style={{
              width: '46px', height: '46px', borderRadius: '0.75rem',
              background: 'rgba(0, 102, 255, 0.1)', color: '#0066FF',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Search size={22} />
            </div>
            <div>
              <p style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600, margin: 0 }}>Total Saved Searches</p>
              <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0f172a', margin: '0.2rem 0 0 0' }}>
                {history.length}
              </h2>
            </div>
          </div>

          <div style={{
            background: '#ffffff',
            borderRadius: '1rem',
            padding: '1.25rem 1.5rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <div style={{
              width: '46px', height: '46px', borderRadius: '0.75rem',
              background: 'rgba(16, 185, 129, 0.1)', color: '#10b981',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Building2 size={22} />
            </div>
            <div>
              <p style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600, margin: 0 }}>Discovered Leads Preserved</p>
              <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0f172a', margin: '0.2rem 0 0 0' }}>
                {totalLeadsSaved}
              </h2>
            </div>
          </div>

          <div style={{
            background: '#ffffff',
            borderRadius: '1rem',
            padding: '1.25rem 1.5rem',
            border: '1px solid #e2e8f0',
            boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <div style={{
              width: '46px', height: '46px', borderRadius: '0.75rem',
              background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Calendar size={22} />
            </div>
            <div>
              <p style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600, margin: 0 }}>Latest Activity</p>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', margin: '0.2rem 0 0 0' }}>
                {history.length > 0 ? new Date(history[0].timestamp).toLocaleDateString() : 'None'}
              </h3>
            </div>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div style={{
          background: '#ffffff',
          borderRadius: '1rem',
          padding: '1rem 1.5rem',
          border: '1px solid #e2e8f0',
          marginBottom: '1.5rem',
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          flexWrap: 'wrap',
          boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
        }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
            <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search past queries (e.g. 'kandy', 'hotels', 'banks')..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '0.65rem 1rem 0.65rem 2.6rem',
                borderRadius: '0.65rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.88rem',
                outline: 'none',
                background: '#f8fafc'
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>Filter by Agent:</span>
            <select
              value={selectedAgentFilter}
              onChange={(e) => setSelectedAgentFilter(e.target.value)}
              style={{
                padding: '0.65rem 1rem',
                borderRadius: '0.65rem',
                border: '1px solid #cbd5e1',
                fontSize: '0.85rem',
                background: '#f8fafc',
                color: '#334155',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="all">All AI Agents</option>
              <option value="allResults">All Search Results (All Scores)</option>
              <option value="lead">Lead Discovery & Prospecting</option>
              <option value="newBusinesses">Find New Businesses</option>
              <option value="research">Customer Research</option>
              <option value="product">Product Recommendations</option>
              <option value="meeting">Meeting Preparation</option>
              <option value="improve">Help Improve Service</option>
            </select>
          </div>
        </div>

        {/* History List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
            <RefreshCw size={32} className="spin" color="#0066FF" style={{ margin: '0 auto 1rem auto' }} />
            <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Loading your saved search history...</p>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div style={{
            background: '#ffffff',
            borderRadius: '1rem',
            padding: '4rem 2rem',
            border: '1.5px dashed #cbd5e1',
            textAlign: 'center'
          }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'rgba(0, 102, 255, 0.08)',
              color: '#0066FF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1rem auto'
            }}>
              <History size={32} />
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.5rem 0' }}>
              No search results saved yet
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.9rem', maxWidth: '440px', margin: '0 auto 1.5rem auto' }}>
              Whenever you search for leads, hotels, or companies on the dashboard, your results are automatically saved here so you can review and export them anytime.
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              style={{
                background: 'linear-gradient(135deg, #0066FF 0%, #10b981 100%)',
                color: '#ffffff',
                border: 'none',
                padding: '0.75rem 1.75rem',
                borderRadius: '0.75rem',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(0, 102, 255, 0.25)'
              }}
            >
              Start a Search on Dashboard →
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filteredHistory.map((item) => {
              const AgentIcon = AGENT_ICONS[item.agentId] || Compass;
              const agentColor = AGENT_COLORS[item.agentId] || '#0066FF';
              const isExpanded = expandedSearchId === item.id;
              const leads = Array.isArray(item.results) ? item.results : [];

              return (
                <div
                  key={item.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: '1rem',
                    border: isExpanded ? '1.5px solid #0066FF' : '1px solid #e2e8f0',
                    boxShadow: isExpanded ? '0 8px 24px rgba(0, 102, 255, 0.08)' : '0 2px 8px rgba(0,0,0,0.02)',
                    transition: 'all 0.2s ease',
                    overflow: 'hidden'
                  }}
                >
                  {/* Card Header Row */}
                  <div style={{
                    padding: '1.25rem 1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    flexWrap: 'wrap'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flex: 1, minWidth: '260px' }}>
                      <div style={{
                        width: '40px', height: '40px', borderRadius: '0.65rem',
                        background: `${agentColor}18`,
                        color: agentColor,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <AgentIcon size={20} />
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{
                            background: `${agentColor}15`,
                            color: agentColor,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '0.2rem 0.6rem',
                            borderRadius: '0.4rem'
                          }}>
                            {item.agentName || 'Lead Discovery'}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                            {new Date(item.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', margin: '0.25rem 0 0 0' }}>
                          "{item.prompt}"
                        </h3>
                      </div>
                    </div>

                    {/* Stats & Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                      <span style={{
                        background: '#f1f5f9',
                        color: '#334155',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        padding: '0.35rem 0.75rem',
                        borderRadius: '0.5rem'
                      }}>
                        {leads.length} Leads
                      </span>

                      <button
                        onClick={() => setExpandedSearchId(isExpanded ? null : item.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          background: isExpanded ? '#eff6ff' : '#ffffff',
                          border: isExpanded ? '1.5px solid #0066FF' : '1px solid #cbd5e1',
                          color: isExpanded ? '#0066FF' : '#475569',
                          padding: '0.45rem 0.85rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        {isExpanded ? (
                          <>Hide Results <ChevronUp size={15} /></>
                        ) : (
                          <>View Leads <ChevronDown size={15} /></>
                        )}
                      </button>

                      <button
                        onClick={() => handleExportExcel(item)}
                        title="Export to Excel (.xlsx)"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#ecfdf5',
                          border: '1px solid #a7f3d0',
                          color: '#059669',
                          padding: '0.45rem 0.75rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <Download size={14} /> Excel
                      </button>

                      <button
                        onClick={() => handleExportPDF(item)}
                        title="Export to PDF"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#f8fafc',
                          border: '1px solid #cbd5e1',
                          color: '#475569',
                          padding: '0.45rem 0.75rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        <FileText size={14} /> PDF
                      </button>

                      <button
                        onClick={() => handleReRun(item)}
                        title="Open & re-run this search on the Dashboard"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: 'linear-gradient(135deg, #0066FF 0%, #0052cc 100%)',
                          border: 'none',
                          color: '#ffffff',
                          padding: '0.45rem 0.85rem',
                          borderRadius: '0.5rem',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        <Sparkles size={14} /> Re-run
                      </button>

                      <button
                        onClick={() => handleDelete(item.id, item.prompt)}
                        title="Delete this saved search"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          color: '#ef4444',
                          padding: '0.45rem 0.6rem',
                          borderRadius: '0.5rem',
                          cursor: 'pointer'
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Expandable Results Table */}
                  {isExpanded && (
                    <div style={{
                      borderTop: '1px solid #f1f5f9',
                      background: '#f8fafc',
                      padding: '1.25rem 1.5rem'
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '0.75rem'
                      }}>
                        <h4 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
                          Saved Companies & Leads ({leads.length})
                        </h4>
                        <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                          Saved permanently in InsightHub server store
                        </span>
                      </div>

                      {leads.length === 0 ? (
                        <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No leads returned for this session.</p>
                      ) : (
                        <div style={{ overflowX: 'auto', background: '#ffffff', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.86rem' }}>
                            <thead>
                              <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#475569' }}>
                                <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Company Name</th>
                                <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Industry & Size</th>
                                <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Location</th>
                                <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Phone</th>
                                <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Rating</th>
                                <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Lead Score</th>
                                <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Website</th>
                                <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>SLT-Mobitel Sales Pitch</th>
                                <th style={{ padding: '0.75rem 1rem', fontWeight: 700 }}>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {leads.map((row, idx) => {
                                const companyName = row['Company Name'] || row['Product'] || row['Section'] || 'N/A';
                                const score = row['Lead Score'];
                                const scoreBg = score === 'High' ? '#dcfce7' : score === 'Medium' ? '#fef3c7' : '#f1f5f9';
                                const scoreColor = score === 'High' ? '#166534' : score === 'Medium' ? '#92400e' : '#475569';

                                return (
                                  <tr
                                    key={idx}
                                    style={{
                                      borderBottom: idx < leads.length - 1 ? '1px solid #f1f5f9' : 'none',
                                      transition: 'background 0.15s ease'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.background = '#f8fafc'}
                                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                                  >
                                    <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#0f172a' }}>
                                      {companyName}
                                    </td>
                                    <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>
                                      {row['Industry'] || 'N/A'} {row['Size'] ? `(${row['Size']})` : ''}
                                    </td>
                                    <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>
                                      {row['Location'] || 'N/A'}
                                    </td>
                                    <td style={{ padding: '0.75rem 1rem', color: '#0f172a', fontWeight: 600 }}>
                                      {row['Contact Number'] && row['Contact Number'] !== 'N/A' ? (
                                        <a href={`tel:${row['Contact Number']}`} style={{ color: '#0066FF', textDecoration: 'none' }}>
                                          {row['Contact Number']}
                                        </a>
                                      ) : 'N/A'}
                                    </td>
                                    <td style={{ padding: '0.75rem 1rem' }}>
                                      <StarRating rating={row['Customer Rating']} />
                                    </td>
                                    <td style={{ padding: '0.75rem 1rem' }}>
                                      <span style={{
                                        background: scoreBg,
                                        color: scoreColor,
                                        padding: '0.2rem 0.55rem',
                                        borderRadius: '0.35rem',
                                        fontSize: '0.78rem',
                                        fontWeight: 700
                                      }}>
                                        {score || 'Low'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '0.75rem 1rem' }}>
                                      {row['Website'] && row['Website'] !== 'N/A' ? (
                                        <a
                                          href={row['Website'].startsWith('http') ? row['Website'] : `https://${row['Website']}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          style={{ color: '#0066FF', display: 'inline-flex', alignItems: 'center', gap: '3px', textDecoration: 'none', fontWeight: 600 }}
                                        >
                                          Visit <ExternalLink size={13} />
                                        </a>
                                      ) : 'N/A'}
                                    </td>
                                    <td style={{ padding: '0.75rem 1rem', maxWidth: '280px', color: '#475569', fontSize: '0.82rem' }}>
                                      {row['Reason'] || row['Why Recommended'] || row['Details'] || row['Content'] || 'N/A'}
                                    </td>
                                    <td style={{ padding: '0.75rem 1rem' }}>
                                      <button
                                        onClick={() => navigate(`/business/${encodeURIComponent(companyName)}`)}
                                        style={{
                                          background: '#eff6ff',
                                          color: '#0066FF',
                                          border: '1px solid #bfdbfe',
                                          padding: '0.35rem 0.65rem',
                                          borderRadius: '0.45rem',
                                          fontSize: '0.78rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                          whiteSpace: 'nowrap'
                                        }}
                                      >
                                        View Details
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchHistory;

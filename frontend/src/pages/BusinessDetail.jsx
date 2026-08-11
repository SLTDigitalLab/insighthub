import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Building2, MapPin, Phone, Star, Globe, Link2,
  Briefcase, FileText, Package, Download, Loader2, Users,
  ChevronDown, ChevronUp, ExternalLink, CheckCircle
} from 'lucide-react';
import axios from 'axios';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { WEBHOOK_URLS } from '../config';
import { fetchProductRecommendations } from '../api';

// Star Rating Component

const StarRating = ({ rating }) => {
  const numRating = parseFloat(rating) || 0;
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(numRating)) {
      stars.push(<span key={i} className="star filled">★</span>);
    } else if (i === Math.ceil(numRating) && numRating % 1 !== 0) {
      stars.push(<span key={i} className="star half">★</span>);
    } else {
      stars.push(<span key={i} className="star">★</span>);
    }
  }
  return (
    <div className="star-rating" style={{ fontSize: '1.1rem' }}>
      {stars}
      <span className="rating-value" style={{ fontSize: '1rem' }}>{numRating > 0 ? numRating.toFixed(1) : 'N/A'}</span>
    </div>
  );
};

// Helper to make URLs clickable
const renderTextWithLinks = (text) => {
  if (typeof text !== 'string') return text;
  
  const urlRegex = /((?:https?:\/\/|www\.|linkedin\.com|facebook\.com)[^\s]+)/g;
  const parts = text.split(urlRegex);
  
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      let href = part;
      let suffix = '';
      
      if (href.endsWith(')') && !href.includes('(')) {
        suffix = ')';
        href = href.slice(0, -1);
      } else if (href.endsWith('.') || href.endsWith(',')) {
        suffix = href.slice(-1);
        href = href.slice(0, -1);
      }
      
      let displayHref = href;
      if (!href.startsWith('http')) {
        href = 'https://' + href;
      }
      
      return (
        <React.Fragment key={i}>
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'underline' }}>
            {displayHref}
          </a>
          {suffix}
        </React.Fragment>
      );
    }
    return part;
  });
};

const BusinessDetail = () => {
  const { companyName } = useParams();
  const navigate = useNavigate();
  const decodedName = decodeURIComponent(companyName);

  const [business, setBusiness] = useState(null);
  const [researchResults, setResearchResults] = useState(null);
  const [meetingResults, setMeetingResults] = useState(null);
  const [productResults, setProductResults] = useState(null);
  const [loadingResearch, setLoadingResearch] = useState(false);
  const [loadingMeeting, setLoadingMeeting] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [expandedSections, setExpandedSections] = useState({ research: true, meeting: true, product: true });
  const [toast, setToast] = useState(null);
  const useMock = localStorage.getItem('useMock') !== 'false';

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const stored = localStorage.getItem('selectedBusiness');
    if (stored) {
      try {
        setBusiness(JSON.parse(stored));
      } catch {
        setBusiness({ 'Company Name': decodedName });
      }
    } else {
      setBusiness({ 'Company Name': decodedName });
    }
  }, [decodedName]);

  // Mock data for business detail page
  const mockResearch = [
    { 'Category': 'Company Overview', 'Details': `${decodedName} is a prominent business entity in Sri Lanka, operating across multiple sectors with a strong market presence.` },
    { 'Category': 'Key Decision Makers', 'Details': 'CEO: Dr. Anil Jayasinghe (linkedin.com/in/anil-j) | CTO: Ruvini Perera (linkedin.com/in/ruvini-p) | CFO: Malik Fernando' },
    { 'Category': 'Employees Found', 'Details': '1. Kasun Silva - Senior Network Engineer (linkedin.com/in/kasun-s) | 2. Nimali Gunawardena - Project Manager (linkedin.com/in/nimali-g) | 3. Thilak Bandara - System Admin (linkedin.com/in/thilak-b)' },
    { 'Category': 'Social Media Presence', 'Details': `LinkedIn: linkedin.com/company/${decodedName.toLowerCase().replace(/\s+/g, '-')} | Facebook: facebook.com/${decodedName.replace(/\s+/g, '')}` },
    { 'Category': 'Recent Developments', 'Details': 'Recently announced a digital transformation initiative. Expanding operations to new regions within Sri Lanka.' },
    { 'Category': 'Current Technology', 'Details': 'Legacy on-premise infrastructure with partial cloud migration. Uses a mix of Dialog and SLT for connectivity.' },
    { 'Category': 'Potential Pain Points', 'Details': '1. Aging network infrastructure. 2. Growing cybersecurity concerns. 3. Need for unified communications. 4. Disaster recovery gaps.' },
  ];

  const mockMeeting = [
    { 'Section': 'Company Insights', 'Content': `${decodedName} is a key player in their sector with significant enterprise connectivity needs across multiple locations.` },
    { 'Section': 'Key People to Meet', 'Content': '1. CTO: Ruvini Perera - Technical decision maker | 2. IT Director: Sampath Jayaweera - Infrastructure buyer | 3. Head of Procurement: Dilini Rathnayake' },
    { 'Section': 'Industry Trends', 'Content': '1. Cloud-first migration strategies. 2. Zero-trust security adoption. 3. 5G-powered IoT solutions. 4. AI-driven automation.' },
    { 'Section': 'Pain Points', 'Content': '1. High network downtime costs. 2. Fragmented communication tools. 3. Compliance and data sovereignty requirements.' },
    { 'Section': 'Discussion Points', 'Content': '1. Current connectivity challenges across branches. 2. Cloud migration timeline and strategy. 3. Business continuity and DR readiness.' },
    { 'Section': 'Objection Handling', 'Content': '1. "Happy with current provider" → Show TCO comparison and 5G advantage. 2. "Budget freeze" → Propose OpEx model with phased deployment.' },
  ];

  const mockProduct = [
    { 'Product': 'SD-WAN Solutions', 'Category': 'Enterprise Connectivity', 'Why Recommended': 'Multi-branch architecture benefits from intelligent traffic routing, 40% cost savings, and cloud app optimization.', 'Priority': 'High' },
    { 'Product': 'Managed Firewall + SOC', 'Category': 'Cybersecurity', 'Why Recommended': 'Growing cyber threats require enterprise-grade protection with 24/7 monitoring.', 'Priority': 'High' },
    { 'Product': 'Hosted PBX / UCaaS', 'Category': 'Unified Communications', 'Why Recommended': 'Replace legacy PBX with cloud-based system for voice, video, chat, and collaboration.', 'Priority': 'Medium' },
    { 'Product': 'Bundle: Enterprise Digital Pack', 'Category': 'Strategic Bundle', 'Why Recommended': 'SD-WAN + SOC + UCaaS + Cloud Backup = Complete transformation at 20% bundle discount.', 'Priority': 'Strategic' },
  ];

  const handleGenerate = async (type) => {
    const setLoading = type === 'research' ? setLoadingResearch : type === 'meeting' ? setLoadingMeeting : setLoadingProduct;
    const setResultsFn = type === 'research' ? setResearchResults : type === 'meeting' ? setMeetingResults : setProductResults;
    const webhookKey = type === 'research' ? 'research' : type === 'meeting' ? 'meeting' : 'product';
    const mockResults = type === 'research' ? mockResearch : type === 'meeting' ? mockMeeting : mockProduct;

    setLoading(true);

    if (useMock) {
      setTimeout(() => {
        setResultsFn(mockResults);
        setLoading(false);
      }, 2000);
      return;
    }

    try {
      const promptText = type === 'research'
        ? `Research the company "${decodedName}" thoroughly. Find all employees, key decision makers, social media profiles.`
        : type === 'meeting'
        ? `Prepare me for a meeting with "${decodedName}". Include key people to meet from LinkedIn.`
        : `Recommend Mobitel products for "${decodedName}" based on their industry and size: ${business?.Industry || 'Unknown'}, ${business?.Size || 'Unknown'}.`;

      if (type === 'product') {
        try {
          const response = await axios.post(
            WEBHOOK_URLS['product'],
            { prompt: promptText },
            { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
          );
          const data = response.data;
          let parsed = null;
          if (data.results && Array.isArray(data.results) && data.results.length > 0) parsed = data.results;
          else if (Array.isArray(data) && data.length > 0) parsed = data;
          else if (typeof data === 'object' && data.output) {
            const jsonMatch = data.output.match(/\[[\s\S]*\]/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
          }

          if (parsed && parsed.length > 0) {
            setResultsFn(parsed);
            return;
          }
        } catch (n8nErr) {
          console.warn('[BusinessDetail Product] n8n unavailable. Falling back to local ChromaDB RAG API:', n8nErr.message);
        }

        const ragRes = await fetchProductRecommendations(promptText);
        if (ragRes && ragRes.results && ragRes.results.length > 0) {
          setResultsFn(ragRes.results);
          return;
        }
      }

      const response = await axios.post(
        WEBHOOK_URLS[webhookKey],
        { prompt: promptText },
        { headers: { 'Content-Type': 'application/json' }, timeout: 120000 }
      );

      const data = response.data;
      if (data.results && Array.isArray(data.results)) {
        setResultsFn(data.results);
      } else if (Array.isArray(data)) {
        setResultsFn(data);
      } else if (typeof data === 'object' && data.output) {
        try {
          const jsonMatch = data.output.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            setResultsFn(JSON.parse(jsonMatch[0]));
          } else {
            setResultsFn([{ 'Response': data.output }]);
          }
        } catch {
          setResultsFn([{ 'Response': data.output }]);
        }
      } else {
        setResultsFn([{ 'Response': JSON.stringify(data) }]);
      }
    } catch (err) {
      console.error(`Error generating ${type}:`, err);
      showToast(`Failed to generate ${type} results.`, 'error');
    } finally {
      setLoading(false);
    }
  };


  const exportSectionToPDF = (sectionName, data) => {
    if (!data || data.length === 0) return;
    const doc = new jsPDF({ orientation: 'landscape' });

    // Header
    doc.setFontSize(18);
    doc.setTextColor(59, 130, 246);
    doc.text('InsightHub - Mobitel Sales Intelligence', 14, 15);
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text(`${sectionName} — ${decodedName}`, 14, 25);
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 32);

    // Company info
    if (business) {
      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);
      const info = `Industry: ${business.Industry || 'N/A'} | Size: ${business.Size || 'N/A'} | Location: ${business.Location || 'N/A'} | Rating: ${business['Customer Rating'] || 'N/A'}`;
      doc.text(info, 14, 40);
    }

    const tableColumn = Object.keys(data[0]);
    const tableRows = data.map(row => tableColumn.map(col => String(row[col] || '')));

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 46,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      columnStyles: tableColumn.reduce((acc, col, i) => {
        if (['Details', 'Content', 'Why Recommended', 'Response'].includes(col)) {
          acc[i] = { cellWidth: 'auto' };
        }
        return acc;
      }, {}),
    });

    doc.save(`Mobitel_${decodedName.replace(/\s+/g, '_')}_${sectionName.replace(/\s+/g, '_')}.pdf`);
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const renderResultsTable = (data, color) => {
    if (!data || data.length === 0) return null;
    const columns = Object.keys(data[0]);
    return (
      <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${color}40` }}>
              {columns.map(key => (
                <th key={key} style={{
                  padding: '0.75rem',
                  color: color,
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontWeight: '700',
                  whiteSpace: 'nowrap'
                }}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}
                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {columns.map((col, j) => (
                  <td key={j} style={{
                    padding: '0.75rem',
                    fontSize: '0.9rem',
                    lineHeight: '1.6',
                    maxWidth: '500px'
                  }}>
                    {col === 'Priority' ? (
                      <span style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '1rem',
                        fontSize: '0.78rem',
                        fontWeight: '700',
                        background: row[col] === 'High' ? '#10b98120' : row[col] === 'Strategic' ? '#3b82f620' : '#f59e0b20',
                        color: row[col] === 'High' ? '#10b981' : row[col] === 'Strategic' ? '#3b82f6' : '#f59e0b'
                      }}>
                        {row[col]}
                      </span>
                    ) : renderTextWithLinks(row[col] || '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  if (!business) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-color)' }}>
        <Loader2 size={48} className="spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-color)', padding: '2rem' }}>
      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          <CheckCircle size={18} />
          {toast.message}
        </div>
      )}

      {/* Back button */}
      <button
        onClick={() => navigate('/dashboard')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          color: 'var(--text-muted)', background: 'transparent', fontSize: '0.9rem',
          marginBottom: '1.5rem', transition: 'color 0.2s'
        }}
        onMouseOver={(e) => e.currentTarget.style.color = 'var(--primary)'}
        onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
      >
        <ArrowLeft size={18} /> Back to Dashboard
      </button>

      {/* Hero Section */}
      <div className="business-detail-hero animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h1>{business['Company Name'] || decodedName}</h1>
          {useMock && (
            <span style={{ background: '#f59e0b', color: 'white', padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.8rem', fontWeight: 'bold' }}>
              DEMO DATA
            </span>
          )}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginTop: '0.25rem' }}>
          {business['Reason'] || 'Enterprise prospect for Mobitel B2B solutions'}
        </p>
        <div className="business-meta">
          <div className="business-meta-item">
            <Building2 size={16} />
            <span><strong>Industry:</strong> {business['Industry'] || 'N/A'}</span>
          </div>
          <div className="business-meta-item">
            <Users size={16} />
            <span><strong>Size:</strong> {business['Size'] || 'N/A'}</span>
          </div>
          <div className="business-meta-item">
            <MapPin size={16} />
            <span><strong>Location:</strong> {business['Location'] || 'N/A'}</span>
          </div>
          <div className="business-meta-item">
            <Phone size={16} />
            <span style={{ color: '#10b981' }}>{business['Contact Number'] || 'N/A'}</span>
          </div>
          <div className="business-meta-item">
            <Star size={16} color="#fbbf24" />
            <StarRating rating={business['Customer Rating']} />
          </div>
          {business['Website'] && (
            <div className="business-meta-item">
              <Globe size={16} />
              <a href={business['Website'].startsWith('http') ? business['Website'] : `https://${business['Website']}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                {business['Website']} <ExternalLink size={12} style={{ display: 'inline' }} />
              </a>
            </div>
          )}
          {business['LinkedIn URL'] && (
            <div className="business-meta-item">
              <Link2 size={16} />
              <a href={business['LinkedIn URL']} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                LinkedIn Profile <ExternalLink size={12} style={{ display: 'inline' }} />
              </a>
            </div>
          )}
        </div>
        {business['Key Decision Makers'] && (
          <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(139, 92, 246, 0.1)', borderRadius: '0.75rem', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
            <p style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#8b5cf6', fontWeight: 700, marginBottom: '0.5rem' }}>Key Decision Makers</p>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.6' }}>{business['Key Decision Makers']}</p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="action-buttons animate-fade-in">
        <button
          className="action-btn research"
          onClick={() => handleGenerate('research')}
          disabled={loadingResearch}
        >
          {loadingResearch ? <Loader2 size={20} className="spin" /> : <Briefcase size={20} />}
          {loadingResearch ? 'Researching...' : 'Customer Research'}
        </button>
        <button
          className="action-btn meeting"
          onClick={() => handleGenerate('meeting')}
          disabled={loadingMeeting}
        >
          {loadingMeeting ? <Loader2 size={20} className="spin" /> : <FileText size={20} />}
          {loadingMeeting ? 'Preparing...' : 'Meeting Preparation'}
        </button>
        <button
          className="action-btn product"
          onClick={() => handleGenerate('product')}
          disabled={loadingProduct}
        >
          {loadingProduct ? <Loader2 size={20} className="spin" /> : <Package size={20} />}
          {loadingProduct ? 'Analyzing...' : 'Product Recommendations'}
        </button>
      </div>

      {/* Customer Research Results */}
      {researchResults && (
        <div className="result-section animate-fade-in">
          <div className="result-section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '0.5rem', background: '#8b5cf620', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Briefcase size={18} color="#8b5cf6" />
              </div>
              <h3 style={{ color: '#8b5cf6' }}>Customer Research</h3>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>({researchResults.length} categories)</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => exportSectionToPDF('Customer Research', researchResults)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  background: '#dc2626', color: 'white',
                  padding: '0.4rem 0.85rem', borderRadius: '0.5rem', fontSize: '0.8rem', fontWeight: 'bold'
                }}
              >
                <Download size={14} /> PDF
              </button>
              <button onClick={() => toggleSection('research')} style={{ background: 'transparent', color: 'var(--text-muted)', padding: '0.4rem' }}>
                {expandedSections.research ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
            </div>
          </div>
          {expandedSections.research && renderResultsTable(researchResults, '#8b5cf6')}
        </div>
      )}

      {/* Meeting Preparation Results */}
      {meetingResults && (
        <div className="result-section animate-fade-in">
          <div className="result-section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '0.5rem', background: '#f59e0b20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={18} color="#f59e0b" />
              </div>
              <h3 style={{ color: '#f59e0b' }}>Meeting Preparation</h3>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>({meetingResults.length} sections)</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => exportSectionToPDF('Meeting Preparation', meetingResults)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  background: '#dc2626', color: 'white',
                  padding: '0.4rem 0.85rem', borderRadius: '0.5rem', fontSize: '0.8rem', fontWeight: 'bold'
                }}
              >
                <Download size={14} /> PDF
              </button>
              <button onClick={() => toggleSection('meeting')} style={{ background: 'transparent', color: 'var(--text-muted)', padding: '0.4rem' }}>
                {expandedSections.meeting ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
            </div>
          </div>
          {expandedSections.meeting && renderResultsTable(meetingResults, '#f59e0b')}
        </div>
      )}

      {/* Product Recommendations Results */}
      {productResults && (
        <div className="result-section animate-fade-in">
          <div className="result-section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '0.5rem', background: '#10b98120', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Package size={18} color="#10b981" />
              </div>
              <h3 style={{ color: '#10b981' }}>Product Recommendations</h3>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>({productResults.length} products)</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => exportSectionToPDF('Product Recommendations', productResults)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  background: '#dc2626', color: 'white',
                  padding: '0.4rem 0.85rem', borderRadius: '0.5rem', fontSize: '0.8rem', fontWeight: 'bold'
                }}
              >
                <Download size={14} /> PDF
              </button>
              <button onClick={() => toggleSection('product')} style={{ background: 'transparent', color: 'var(--text-muted)', padding: '0.4rem' }}>
                {expandedSections.product ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
            </div>
          </div>
          {expandedSections.product && renderResultsTable(productResults, '#10b981')}
        </div>
      )}

      {/* Empty state when no results generated yet */}
      {!researchResults && !meetingResults && !productResults && !loadingResearch && !loadingMeeting && !loadingProduct && (
        <div className="animate-fade-in" style={{
          textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)',
          background: 'var(--card-bg)', borderRadius: '1rem', border: '1px solid var(--border-color)'
        }}>
          <Building2 size={56} style={{ opacity: 0.15, marginBottom: '1rem' }} />
          <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Click an action button above to generate insights</p>
          <p style={{ fontSize: '0.85rem' }}>Each section will appear below with its own PDF download option</p>
        </div>
      )}
    </div>
  );
};

export default BusinessDetail;

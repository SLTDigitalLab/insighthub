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

// Star Rating Component (Google Reviews)
const StarRating = ({ rating }) => {
  const numRating = parseFloat(rating) || 4.5;
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(numRating)) {
      stars.push(<span key={i} style={{ color: '#f59e0b', fontSize: '1.1rem' }}>★</span>);
    } else if (i === Math.ceil(numRating) && numRating % 1 !== 0) {
      stars.push(<span key={i} style={{ color: '#f59e0b', opacity: 0.7, fontSize: '1.1rem' }}>★</span>);
    } else {
      stars.push(<span key={i} style={{ color: 'rgba(255,255,255,0.2)', fontSize: '1.1rem' }}>★</span>);
    }
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(245, 158, 11, 0.08)', padding: '0.3rem 0.8rem', borderRadius: '0.5rem', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
      <div style={{ display: 'flex', gap: '2px' }}>{stars}</div>
      <span style={{ fontWeight: 700, color: '#f59e0b', fontSize: '1rem' }}>{numRating.toFixed(1)}</span>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>(Google Review Rating)</span>
    </div>
  );
};

const KNOWN_LABELS = [
  'Problem Solved',
  'Key Features from Knowledge Base',
  'Key Features',
  'Expected Value',
  'Why Recommended',
  'Core Features',
  'Sales Pitch Question',
  'Expected ROI & Value',
  'Potential Pain Points',
  'Current Technology',
  'Recent Developments',
  'Social Media Presence'
];

// Rich text formatter for meeting prep, customer research, and product recommendations
const renderFormattedText = (rawText, accentColor = '#0066FF') => {
  if (typeof rawText !== 'string') return rawText;

  // Split on double line breaks, single line breaks, or inline bold sections like 1. **Title** or **Why Recommended:**
  const lines = rawText
    .split(/(?:\r?\n|(?=\d+\.\s+\*\*)|(?=\*\*(?:Why Recommended|Key Features|Sales Pitch Question|Expected ROI|Core Features|Potential Pain Points)[^*]*\*\*))/g)
    .filter(Boolean)
    .filter(line => /[a-zA-Z0-9]/.test(line.trim()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      {lines.map((lineText, lineIdx) => {
        const trimmed = lineText.trim();
        const isNewProduct = /^\d+\.\s+\*\*/.test(trimmed);

        const renderLineContent = (str) => {
          const labelMatch = KNOWN_LABELS
            .map(label => ({ label, re: new RegExp(`^(${label}:?)\\s*`, 'i') }))
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
              const isSubLabel = boldContent.trim().endsWith(':') || KNOWN_LABELS.some(l => boldContent.includes(l));
              return (
                <strong
                  key={pIdx}
                  style={{
                    color: isSubLabel ? '#0f172a' : accentColor,
                    fontWeight: 700,
                    marginRight: '0.25rem'
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
                    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#0066FF', textDecoration: 'underline', fontWeight: 500 }}>
                      {displayHref}
                    </a>
                    {suffix}
                  </React.Fragment>
                );
              }
              return <span key={uIdx} style={{ color: '#334155' }}>{subPart}</span>;
            });
          });

          return (
            <>
              {prefix && <strong style={{ color: '#0f172a', fontWeight: 700 }}>{prefix} </strong>}
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
                  borderTop: '1px solid #e2e8f0',
                  margin: '0.75rem 0'
                }}
              />
            )}
            <div style={{ lineHeight: '1.65', fontSize: '0.88rem' }}>
              {renderLineContent(trimmed)}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
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

  const handleGenerate = async (type) => {
    const setLoading = type === 'research' ? setLoadingResearch : type === 'meeting' ? setLoadingMeeting : setLoadingProduct;
    const setResultsFn = type === 'research' ? setResearchResults : type === 'meeting' ? setMeetingResults : setProductResults;
    const webhookKey = type === 'research' ? 'research' : type === 'meeting' ? 'meeting' : 'product';

    setLoading(true);

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
                    ) : (
                      renderFormattedText(row[col] || '', color)
                    )}
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

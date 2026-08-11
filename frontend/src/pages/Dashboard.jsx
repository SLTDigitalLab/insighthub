import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LogOut, Users, Briefcase, FileText, Package, Download, Loader2, AlertCircle, ChevronRight, Mail, Star, Phone, ExternalLink, CheckCircle, UploadCloud, X, Database, Trash2, Layers } from 'lucide-react';
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
  fetchLeadDiscovery
} from '../api';


const agents = [
  {
    id: 'lead',
    name: 'Lead Discovery & Prospecting',
    icon: Users,
    desc: 'Find newly registered businesses and discover companies by industry, location, and size.',
    placeholder: 'e.g. "Find tech startups in Colombo" or "Banking companies in Sri Lanka"',
    color: '#3b82f6'
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
    <div className="star-rating">
      {stars}
      <span className="rating-value">{numRating > 0 ? numRating.toFixed(1) : 'N/A'}</span>
    </div>
  );
};

// Helper to make URLs clickable
const renderFormattedText = (rawText) => {
  if (typeof rawText !== 'string') return rawText;

  // Split by newlines or numbered list patterns if multi-item
  const lines = rawText.split(/(?:\r?\n|(?=\d+\.\s+\*\*))/g).filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {lines.map((lineText, lineIdx) => {
        // Helper to convert URLs and bold markdown inside each line
        const renderLineContent = (str) => {
          // Parse bold markdown **text**
          const parts = str.split(/(\*\*[^*]+\*\*)/g);
          return parts.map((part, pIdx) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              const boldContent = part.slice(2, -2);
              return (
                <strong key={pIdx} style={{ color: '#6366f1', fontWeight: 700 }}>
                  {boldContent}
                </strong>
              );
            }

            // Parse URLs
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
        };

        return (
          <div key={lineIdx} style={{ lineHeight: '1.6' }}>
            {renderLineContent(lineText.trim())}
          </div>
        );
      })}
    </div>
  );
};

const renderTextWithLinks = (text) => renderFormattedText(text);

const Dashboard = () => {
  const [activeAgent, setActiveAgent] = useState(agents[0]);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [useMock, setUseMock] = useState(() => localStorage.getItem('useMock') !== 'false');
  const [emailSending, setEmailSending] = useState(false);
  
  // Knowledge Base State
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

  const toggleMock = () => {
    const newValue = !useMock;
    setUseMock(newValue);
    localStorage.setItem('useMock', newValue);
  };
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();
  const userEmail = localStorage.getItem('userEmail') || '';

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleLogout = () => {
    localStorage.removeItem('userEmail');
    navigate('/login');
  };

  // ====== MOCK DATA FOR EACH AGENT (for testing without n8n) ======
  const mockData = {
    lead: [
      { 'Company Name': 'Lanka Hospitals PLC', 'Industry': 'Healthcare', 'Size': 'Large', 'Location': 'Colombo', 'Contact Number': '+94 11 553 0000', 'Customer Rating': 4.2, 'Lead Score': 'High', 'Key Decision Makers': 'CEO: Dr. Prasad Medawatte, CTO: Amal Perera', 'LinkedIn URL': 'https://linkedin.com/company/lanka-hospitals', 'Website': 'www.lankahospitals.com', 'Reason': 'Large hospital chain needing SD-WAN and IoT for medical devices' },
      { 'Company Name': 'MAS Holdings', 'Industry': 'Manufacturing', 'Size': 'Enterprise', 'Location': 'Colombo', 'Contact Number': '+94 11 200 5000', 'Customer Rating': 4.5, 'Lead Score': 'High', 'Key Decision Makers': 'CEO: Suren Fernando, CIO: Dinesh Wickramasinghe', 'LinkedIn URL': 'https://linkedin.com/company/mas-holdings', 'Website': 'www.masholdings.com', 'Reason': 'Global manufacturer needing MPLS VPN across 50+ factories' },
      { 'Company Name': 'Virtusa (Pvt) Ltd', 'Industry': 'IT/BPO', 'Size': 'Enterprise', 'Location': 'Colombo', 'Contact Number': '+94 11 267 8000', 'Customer Rating': 3.8, 'Lead Score': 'Medium', 'Key Decision Makers': 'Country Head: Madu Ratnayake, VP Engineering: Sanjeev Kumar', 'LinkedIn URL': 'https://linkedin.com/company/virtusa', 'Website': 'www.virtusa.com', 'Reason': 'IT company requiring high-speed DIA and cloud solutions' },
      { 'Company Name': 'Cinnamon Hotels & Resorts', 'Industry': 'Hospitality', 'Size': 'Large', 'Location': 'Colombo', 'Contact Number': '+94 11 230 0800', 'Customer Rating': 4.4, 'Lead Score': 'High', 'Key Decision Makers': 'CEO: Hiran Cooray, IT Director: Ruwan Silva', 'LinkedIn URL': 'https://linkedin.com/company/cinnamon-hotels', 'Website': 'www.cinnamonhotels.com', 'Reason': 'Hotel chain needing managed WiFi and UCaaS across properties' },
      { 'Company Name': 'Sampath Bank PLC', 'Industry': 'Banking & Finance', 'Size': 'Enterprise', 'Location': 'Colombo', 'Contact Number': '+94 11 230 3050', 'Customer Rating': 4.1, 'Lead Score': 'High', 'Key Decision Makers': 'MD: Nanda Fernando, CTO: Chaminda Jayasuriya', 'LinkedIn URL': 'https://linkedin.com/company/sampath-bank', 'Website': 'www.sampath.lk', 'Reason': 'Major bank needing cybersecurity, SD-WAN, and disaster recovery' },
    ],
    research: [
      { 'Category': 'Company Overview', 'Details': 'John Keells Holdings is Sri Lanka\'s largest listed conglomerate on the Colombo Stock Exchange. Diversified across transportation, leisure, property, consumer foods, and IT.' },
      { 'Category': 'Key Decision Makers', 'Details': 'Chairman: Krishan Balendra (linkedin.com/in/krishan-balendra) | Group Finance Director: Gihan Cooray | CTO: Ramesh Fernando' },
      { 'Category': 'Employees Found', 'Details': '1. Nimal Jayawardena - Senior Software Engineer (linkedin.com/in/nimal-j) | 2. Asha Wijesinghe - Marketing Manager (linkedin.com/in/asha-w) | 3. Rohan De Silva - Network Admin (linkedin.com/in/rohan-ds) | 4. Priya Mendis - HR Director (linkedin.com/in/priya-m)' },
      { 'Category': 'Social Media Presence', 'Details': 'LinkedIn: linkedin.com/company/john-keells-holdings | Facebook: facebook.com/JohnKeellsGroup | Twitter: @JohnKeellsGroup' },
      { 'Category': 'Recent Developments', 'Details': 'Investing $500M in Colombo Port City mixed-use development. Launched digital transformation across leisure sector in 2024.' },
      { 'Category': 'Current Technology', 'Details': 'Uses a mix of Dialog and SLT for enterprise connectivity. On-premise data centers. Microsoft 365 for collaboration.' },
      { 'Category': 'Potential Pain Points', 'Details': '1. Managing connectivity across 70+ companies. 2. Legacy systems in some subsidiaries. 3. Cybersecurity at scale. 4. Cloud migration challenges.' },
    ],
    meeting: [
      { 'Section': 'Company Insights', 'Content': 'Commercial Bank is the largest private bank in Sri Lanka with 270+ branches and 900+ ATMs. Revenue exceeded LKR 150B in 2023.' },
      { 'Section': 'Key People to Meet', 'Content': '1. CTO: Sanjeev Jha (linkedin.com/in/sanjeev-jha) | 2. IT Director: Pradeep Amirthanayagam (linkedin.com/in/pradeep-a) | 3. Head of Procurement: Mahesh Gunasekara' },
      { 'Section': 'Industry Trends', 'Content': '1. Digital banking & mobile-first strategies. 2. Open Banking API adoption. 3. AI-powered fraud detection. 4. Regulatory push for data localization.' },
      { 'Section': 'Pain Points', 'Content': '1. Inter-branch connectivity latency affecting core banking. 2. Growing cybersecurity threats targeting financial data. 3. Customer demand for omni-channel contact center.' },
      { 'Section': 'Discussion Points', 'Content': '1. Ask about their branch network expansion plans. 2. Discuss SD-WAN benefits over legacy MPLS. 3. Explore their disaster recovery readiness.' },
      { 'Section': 'Objection Handling', 'Content': '1. "We use Dialog" → Highlight Mobitel\'s 5G coverage advantage and competitive SLA. 2. "Budget constraints" → Propose phased rollout starting with critical branches.' },
      { 'Section': 'Competitor Analysis', 'Content': 'Dialog Enterprise is the incumbent. SLT provides leased lines. Mobitel differentiates with bundled solutions, local cloud, and dedicated enterprise account managers.' },
    ],
    product: [
      { 'Product': 'SD-WAN Solutions', 'Category': 'Enterprise Connectivity', 'Why Recommended': 'With 270+ branches, SD-WAN provides intelligent routing, 40% cost reduction over MPLS, and seamless cloud banking app performance.', 'Priority': 'High' },
      { 'Product': 'Managed Firewall + SOC', 'Category': 'Cybersecurity', 'Why Recommended': 'Banking sector compliance requires robust threat protection. 24/7 SOC ensures real-time monitoring of financial transactions.', 'Priority': 'High' },
      { 'Product': 'Contact Center as a Service (CCaaS)', 'Category': 'Unified Communications', 'Why Recommended': 'Replace legacy call center with AI-powered routing, omni-channel support, and analytics for better customer experience.', 'Priority': 'Medium' },
      { 'Product': 'Disaster Recovery as a Service (DRaaS)', 'Category': 'Cloud & Data Center', 'Why Recommended': 'Financial regulators require business continuity plans. DRaaS ensures zero data loss and rapid failover.', 'Priority': 'High' },
      { 'Product': 'Bundle: Digital Banking Infrastructure Pack', 'Category': 'Strategic Bundle', 'Why Recommended': 'SD-WAN + SOC + DRaaS + CCaaS = Complete digital transformation at 25% bundle discount. Estimated deployment: 8-12 weeks.', 'Priority': 'Strategic' },
    ],
    improve: [
      { 'Category': 'Overall Sentiment', 'Details': 'Mixed (3.5/5 on Google, 3.2/5 on Facebook). Generally praised for network coverage but criticized for customer service responsiveness.' },
      { 'Category': 'Key Complaints', 'Details': '1. Long wait times on customer service hotline. 2. Billing discrepancies and delayed refunds. 3. Poor communication during scheduled maintenance.' },
      { 'Category': 'Service Improvement Recommendations', 'Details': '1. Implement an AI chatbot for initial customer service triage to reduce wait times. 2. Automate SMS notifications for billing and maintenance. 3. Introduce a self-service portal for bill disputes.' },
      { 'Category': 'Employees Found (Facebook/LinkedIn)', 'Details': '1. Kamal Silva - Customer Service Manager (facebook.com/kamal.s) | 2. Nuwan Perera - Technical Support Lead (linkedin.com/in/nuwan-p) | 3. Dilani Fernando - PR Manager (facebook.com/dilani.f)' }
    ],
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!prompt) return;

    setLoading(true);
    setResults(null);
    setError(null);

    if (useMock) {
      setTimeout(() => {
        setResults(mockData[activeAgent.id]);
        setLoading(false);
      }, 1500);
      return;
    }

    try {
      if (activeAgent.id === 'lead') {
        try {
          const response = await axios.post(
            WEBHOOK_URLS['lead'],
            { prompt: prompt },
            { headers: { 'Content-Type': 'application/json' }, timeout: 25000 }
          );

          const data = response.data;
          let parsed = null;

          if (data.results && Array.isArray(data.results) && data.results.length > 0) {
            parsed = data.results;
          } else if (Array.isArray(data) && data.length > 0) {
            parsed = data;
          } else if (typeof data === 'object' && data.output) {
            const jsonMatch = data.output.match(/\[[\s\S]*\]/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
          }

          if (parsed && parsed.length > 0) {
            setResults(parsed);
            return;
          }
        } catch (n8nErr) {
          console.warn('[Lead Agent] n8n webhook unavailable or errored out. Falling back to local Sri Lanka business directory API:', n8nErr.message);
        }

        // Direct Local Sri Lanka Business Directory fallback
        const leadRes = await fetchLeadDiscovery(prompt);
        if (leadRes && leadRes.results && leadRes.results.length > 0) {
          setResults(leadRes.results);
          return;
        }
      } else if (activeAgent.id === 'product') {
        try {
          const response = await axios.post(
            WEBHOOK_URLS['product'],
            { prompt: prompt },
            { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
          );

          const data = response.data;
          let parsed = null;

          if (data.results && Array.isArray(data.results) && data.results.length > 0) {
            parsed = data.results;
          } else if (Array.isArray(data) && data.length > 0) {
            parsed = data;
          } else if (typeof data === 'object' && data.output) {
            const jsonMatch = data.output.match(/\[[\s\S]*\]/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
          }

          if (parsed && parsed.length > 0) {
            setResults(parsed);
            return;
          }
        } catch (n8nErr) {
          console.warn('[Product Agent] n8n webhook unavailable or errored out. Falling back to local ChromaDB RAG API:', n8nErr.message);
        }

        // Direct Local ChromaDB RAG fallback
        const ragRes = await fetchProductRecommendations(prompt);
        if (ragRes && ragRes.results && ragRes.results.length > 0) {
          setResults(ragRes.results);
          return;
        }
      } else if (activeAgent.id === 'meeting') {
        try {
          const response = await axios.post(
            WEBHOOK_URLS['meeting'],
            { prompt: prompt },
            { headers: { 'Content-Type': 'application/json' }, timeout: 25000 }
          );

          const data = response.data;
          let parsed = null;

          if (data.results && Array.isArray(data.results) && data.results.length > 0) {
            parsed = data.results;
          } else if (Array.isArray(data) && data.length > 0) {
            parsed = data;
          } else if (typeof data === 'object' && data.output) {
            const jsonMatch = data.output.match(/\[[\s\S]*\]/);
            if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
          }

          if (parsed && parsed.length > 0) {
            setResults(parsed);
            return;
          }
        } catch (n8nErr) {
          console.warn('[Meeting Agent] n8n webhook unavailable or errored out. Falling back to local ChromaDB RAG API:', n8nErr.message);
        }

        // Direct Local ChromaDB RAG fallback for Meeting Prep
        const meetingRes = await fetchMeetingPreparation(prompt);
        if (meetingRes && meetingRes.results && meetingRes.results.length > 0) {
          setResults(meetingRes.results);
          return;
        }
      }

      // 2. Standard webhook call for other agents
      const response = await axios.post(
        WEBHOOK_URLS[activeAgent.id],
        { prompt: prompt },
        { headers: { 'Content-Type': 'application/json' }, timeout: 120000 }
      );

      const data = response.data;

      if (data.results && Array.isArray(data.results)) {
        setResults(data.results);
      } else if (Array.isArray(data)) {
        setResults(data);
      } else if (typeof data === 'object' && data.output) {
        try {
          const jsonMatch = data.output.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            setResults(JSON.parse(jsonMatch[0]));
          } else {
            setResults([{ 'Response': data.output }]);
          }
        } catch {
          setResults([{ 'Response': data.output }]);
        }
      } else {
        setResults([{ 'Response': JSON.stringify(data) }]);
      }
    } catch (err) {
      console.error('Error calling webhook/backend:', err);
      setError(
        err.response?.data?.message ||
        err.message ||
        'Failed to connect to backend or n8n service.'
      );
    } finally {
      setLoading(false);
    }
  };


  const handleEmailResults = async () => {
    if (!results || !userEmail) return;
    setEmailSending(true);
    try {
      await axios.post(
        WEBHOOK_URLS.email,
        {
          email: userEmail,
          subject: `InsightHub - ${activeAgent.name} Results`,
          agentName: activeAgent.name,
          results: results
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      showToast(`Results emailed to ${userEmail}`, 'success');
    } catch (err) {
      console.error('Email error:', err);
      showToast('Failed to send email. Check n8n SMTP settings.', 'error');
    } finally {
      setEmailSending(false);
    }
  };

  const handleCompanyClick = (row) => {
    // Store the full company data in localStorage for the detail page
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
        if (['Details', 'Content', 'Why Recommended', 'Reason', 'Insights', 'Response', 'Key Decision Makers'].includes(col)) {
          acc[i] = { cellWidth: 'auto' };
        }
        return acc;
      }, {}),
    });

    doc.save(`Mobitel_${activeAgent.id}_report.pdf`);
  };

  // Check if current results are lead discovery (have Company Name column)
  const isLeadResults = results && results.length > 0 && results[0]['Company Name'];

  // For lead results, define which columns to display in the compact table
  const leadDisplayColumns = ['Company Name', 'Industry', 'Size', 'Location', 'Contact Number', 'Customer Rating', 'Lead Score'];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-color)' }}>
      {/* Toast notification */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          <CheckCircle size={18} />
          {toast.message}
        </div>
      )}

      {/* Sidebar */}
      <div style={{
        width: '300px',
        background: 'var(--card-bg)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0
      }}>
        {/* Logo */}
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 'bold' }}>
            <span style={{ background: 'linear-gradient(135deg, #3b82f6, #10b981)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Insight</span>Hub
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>Sri Lanka Telecom Mobitel</p>
        </div>

        {/* Agent Navigation */}
        <div style={{ padding: '0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0.5rem 0.75rem' }}>AI Agents</p>
          {agents.map(agent => {
            const Icon = agent.icon;
            const isActive = activeAgent.id === agent.id;
            return (
              <button
                key={agent.id}
                onClick={() => { setActiveAgent(agent); setResults(null); setError(null); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.85rem 1rem',
                  background: isActive ? `${agent.color}15` : 'transparent',
                  color: isActive ? agent.color : 'var(--text-main)',
                  borderLeft: isActive ? `3px solid ${agent.color}` : '3px solid transparent',
                  borderRadius: '0 0.5rem 0.5rem 0',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  width: '100%',
                  fontSize: '0.9rem'
                }}
              >
                <Icon size={18} />
                <span style={{ fontWeight: isActive ? '600' : 'normal', flex: 1 }}>{agent.name}</span>
                {isActive && <ChevronRight size={14} />}
              </button>
            );
          })}
        </div>

        {/* User Info + Mode Toggle + Logout */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {userEmail && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.25rem 0' }}>
              <Mail size={14} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userEmail}</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
            <label style={{ color: 'var(--text-muted)', flex: 1 }}>
              {useMock ? '🟡 Demo Mode' : '🟢 Live (n8n)'}
            </label>
            <button
              onClick={toggleMock}
              style={{
                background: useMock ? '#f59e0b' : '#10b981',
                color: 'white',
                padding: '0.3rem 0.75rem',
                borderRadius: '1rem',
                fontSize: '0.75rem',
                fontWeight: 'bold'
              }}
            >
              {useMock ? 'Switch to Live' : 'Switch to Demo'}
            </button>
          </div>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              color: '#ef4444', background: 'transparent', width: '100%', padding: '0.5rem', fontSize: '0.9rem'
            }}
          >
            <LogOut size={18} /> Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {/* Header */}
        <div className="animate-fade-in" key={activeAgent.id} style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '0.75rem',
                background: `${activeAgent.color}20`,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <activeAgent.icon size={22} color={activeAgent.color} />
              </div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold' }}>{activeAgent.name}</h1>
            </div>
            <p style={{ color: 'var(--text-muted)', marginLeft: '3.25rem' }}>{activeAgent.desc}</p>
          </div>
          
          <button
            onClick={() => setShowKBModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', color: 'white',
              padding: '0.65rem 1.25rem', borderRadius: '0.65rem', fontSize: '0.85rem', fontWeight: 'bold',
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
              border: 'none', cursor: 'pointer'
            }}
          >
            <Database size={16} /> Knowledge Base & Vector DB
          </button>
        </div>

        {/* Search Area */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={20} style={{ position: 'absolute', top: '50%', left: '1rem', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder={activeAgent.placeholder}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{ width: '100%', paddingLeft: '3rem', fontSize: '1rem', height: '52px' }}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !prompt}
            style={{
              background: loading ? 'var(--border-color)' : activeAgent.color,
              color: 'white',
              padding: '0 2rem',
              borderRadius: '0.5rem',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              opacity: (!prompt || loading) ? 0.6 : 1,
              transition: 'all 0.2s',
              height: '52px',
              whiteSpace: 'nowrap'
            }}
          >
            {loading ? <><Loader2 size={18} className="spin" /> Processing...</> : <><Search size={18} /> Search</>}
          </button>
        </form>

        {/* Error State */}
        {error && (
          <div className="animate-fade-in" style={{
            background: '#dc262615', border: '1px solid #dc262650', borderRadius: '0.75rem',
            padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem'
          }}>
            <AlertCircle size={20} color="#dc2626" />
            <p style={{ color: '#fca5a5' }}>{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem'
          }}>
            <div className="spin" style={{ width: '48px', height: '48px', border: `3px solid var(--border-color)`, borderTop: `3px solid ${activeAgent.color}`, borderRadius: '50%' }}></div>
            <p style={{ color: 'var(--text-muted)' }}>AI Agent is analyzing your request...</p>
          </div>
        )}

        {/* Results Table */}
        {results && results.length > 0 && !loading && (
          <div className="animate-fade-in" style={{
            background: 'var(--card-bg)',
            borderRadius: '1rem',
            padding: '1.5rem',
            border: '1px solid var(--border-color)',
            flex: 1,
            overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 'bold' }}>
                Results <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: '0.85rem' }}>({results.length} items)</span>
              </h3>
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

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${activeAgent.color}40` }}>
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
                  {results.map((row, i) => (
                    <tr
                      key={i}
                      className={isLeadResults ? 'clickable-row' : ''}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        transition: 'background 0.15s'
                      }}
                      onClick={isLeadResults ? () => handleCompanyClick(row) : undefined}
                      onMouseOver={(e) => { if (!isLeadResults) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                      onMouseOut={(e) => { if (!isLeadResults) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {(isLeadResults ? leadDisplayColumns : Object.keys(row)).map((col, j) => (
                        <td key={j} style={{
                          padding: '0.85rem 0.75rem',
                          fontSize: '0.9rem',
                          lineHeight: '1.5',
                          maxWidth: '400px'
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
                              padding: '0.25rem 0.75rem',
                              borderRadius: '1rem',
                              fontSize: '0.8rem',
                              fontWeight: '700',
                              background: row[col] === 'High' ? '#10b98120' : row[col] === 'Medium' ? '#f59e0b20' : '#ef444420',
                              color: row[col] === 'High' ? '#10b981' : row[col] === 'Medium' ? '#f59e0b' : '#ef4444'
                            }}>
                              {row[col]}
                            </span>
                          ) : (
                            renderTextWithLinks(row[col] || '')
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty State */}
        {(!results || results.length === 0) && !loading && !error && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', gap: '0.75rem'
          }}>
            <activeAgent.icon size={48} style={{ opacity: 0.2 }} />
            <p style={{ fontSize: '1.1rem' }}>Enter a prompt above to get started</p>
            <p style={{ fontSize: '0.85rem', maxWidth: '400px', textAlign: 'center' }}>
              {useMock
                ? 'Running in Demo Mode — results are pre-loaded sample data.'
                : 'Connected to n8n — make sure your workflows are active.'}
            </p>
          </div>
        )}
      </div>

      {/* Local Knowledge Base & Vector DB Modal */}
      {showKBModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1.5rem'
        }}>
          <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--border-color)',
            borderRadius: '1rem', width: '100%', maxWidth: '850px', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(255,255,255,0.02)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Database size={22} color="#3b82f6" />
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Local Knowledge Base & Vector Store</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Local storage & ChromaDB vector database index for n8n RAG workflows
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowKBModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.25rem' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* File Upload Section */}
              <div style={{
                border: '2px dashed var(--border-color)', borderRadius: '0.75rem',
                padding: '1.5rem', textAlign: 'center', background: 'rgba(255,255,255,0.01)'
              }}>
                <UploadCloud size={36} style={{ color: '#3b82f6', marginBottom: '0.5rem', opacity: 0.8 }} />
                <h4 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.25rem' }}>Upload Document to Local Vector Store</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  Supports PDF, TXT, DOCX, CSV. Extracted text will be chunked and indexed automatically.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                  <input
                    type="file"
                    id="kb-file-input"
                    accept=".pdf,.txt,.docx,.csv,.json"
                    onChange={(e) => setSelectedFile(e.target.files[0])}
                    style={{ display: 'none' }}
                  />
                  <label
                    htmlFor="kb-file-input"
                    style={{
                      padding: '0.6rem 1.25rem', background: 'var(--border-color)',
                      borderRadius: '0.5rem', fontSize: '0.85rem', cursor: 'pointer',
                      fontWeight: '500', color: 'var(--text-main)'
                    }}
                  >
                    {selectedFile ? selectedFile.name : 'Choose Local File'}
                  </label>

                  <button
                    onClick={handleFileUpload}
                    disabled={!selectedFile || uploading}
                    style={{
                      padding: '0.6rem 1.25rem', background: selectedFile && !uploading ? '#3b82f6' : 'var(--border-color)',
                      color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.85rem',
                      fontWeight: '600', cursor: selectedFile && !uploading ? 'pointer' : 'not-allowed',
                      opacity: selectedFile && !uploading ? 1 : 0.6
                    }}
                  >
                    {uploading ? <><Loader2 size={16} className="spin" /> Indexing...</> : 'Upload & Vectorize'}
                  </button>
                </div>

                {uploading && (
                  <div style={{ marginTop: '1rem', width: '100%', background: 'var(--border-color)', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${uploadProgress}%`, background: '#3b82f6', height: '100%', transition: 'width 0.3s' }} />
                  </div>
                )}
              </div>

              {/* Vector RAG Search Test */}
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

              {/* Indexed Documents List */}
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

            {/* Modal Footer */}
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

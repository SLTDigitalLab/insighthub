import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Sparkles, Layers, Upload } from 'lucide-react';

// The Proposal Hub header, shared by the Product, Solution and Product + Solution pages (it is the Product page's own header, moved here).
//   activeTab  'generator' | 'archive' | 'template'   which tab is highlighted
//   onTab      (tab) => void   what a tab does. Without it (the Solution and Product + Solution pages) "Generated Proposals" opens the archive and
//              "Upload Latest Template" opens the template tab of `type` on the Product page; "Generate Proposal" goes to `generatePath` / onGenerate
//   count      number in "Generated Proposals (N)"; read from the server when not given
//   type       'product' | 'solution' | 'productSolution': the template tab that "Upload Latest Template" pre-selects
//   typeLabel  small label next to the Enterprise badge (the proposal type); none on the Product page
//   showGenerate / showTemplate  tab visibility (the Product page shows both only to admins)
export default function ProposalHubHeader({ activeTab = 'generator', onTab = null, count = null, type = 'product', typeLabel = '', generatePath = '/proposals/product', onGenerate = null, showGenerate = false, showTemplate = false }) {
  const navigate = useNavigate();
  const [fetched, setFetched] = useState(null);

  useEffect(() => {
    if (count !== null) return undefined;
    let cancelled = false;
    axios.get('/api/proposals/saved').then(({ data }) => { if (!cancelled && Array.isArray(data.proposals)) setFetched(data.proposals.length); }).catch(() => { /* the count just stays out */ });
    return () => { cancelled = true; };
  }, [count]);
  const n = count !== null ? count : fetched;

  const go = tab => {
    if (onTab) return onTab(tab);
    if (tab === 'generator') return onGenerate ? onGenerate() : navigate(generatePath);
    if (tab === 'archive') return navigate('/proposals/product?tab=archive');
    return navigate(`/proposals/product?tab=template${type === 'product' ? '' : `&type=${type}`}`);
  };

  const tabStyle = key => ({
    display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px',
    fontSize: '0.85rem', fontWeight: 700, borderRadius: 6, border: 'none', cursor: 'pointer',
    whiteSpace: 'nowrap',
    background: activeTab === key ? '#ffffff' : 'transparent',
    color: activeTab === key ? '#0B2A6F' : '#64748b',
    boxShadow: activeTab === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
  });
  const icon = key => (activeTab === key ? '#0284c7' : '#64748b');

  return (
    <header className="proposal-hub-header" style={{
      background: '#ffffff', borderBottom: '1px solid #e2e8f0',
      padding: '14px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      flexWrap: 'wrap', gap: 12,
      position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => navigate('/proposals')}
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
              {typeLabel && <span style={{ fontSize: '0.72rem', background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{typeLabel}</span>}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Dynamic corporate proposals, single active template system & historical proposal records</div>
          </div>
        </div>
      </div>

      {/* Tab Switcher Buttons */}
      <div className="proposal-hub-tabs">
        {showGenerate && (
          <button onClick={() => go('generator')} style={tabStyle('generator')}>
            <Sparkles size={16} color={icon('generator')} />
            Generate Proposal
          </button>
        )}

        <button onClick={() => go('archive')} style={tabStyle('archive')}>
          <Layers size={16} color={icon('archive')} />
          Generated Proposals{n !== null ? ` (${n})` : ''}
        </button>

        {showTemplate && (
          <button onClick={() => go('template')} style={tabStyle('template')}>
            <Upload size={16} color={icon('template')} />
            Upload Latest Template
          </button>
        )}
      </div>
    </header>
  );
}

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Layers, Boxes, ArrowLeft, ChevronRight, Search } from 'lucide-react';

const OPTIONS = [
  {
    id: 'product',
    title: 'Product Proposal',
    desc: 'Generate proposals for selected SLT products using the active template.',
    icon: FileText,
    path: '/proposals/product',
  },
  {
    id: 'solution',
    title: 'Solution Proposal',
    desc: 'Build end-to-end solution proposals.',
    icon: Layers,
    path: '/proposals/solution',
  },
  {
    id: 'product-solution',
    title: 'Product + Solution Proposal',
    desc: 'Combine selected SLT products with a solution quotation in one proposal.',
    icon: Boxes,
    path: '/proposals/product-solution',
  },
];

export default function ProposalTypeSelect() {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(null);

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', color: '#0f172a', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <header style={{
        background: '#ffffff', borderBottom: '1px solid #e2e8f0',
        padding: '14px 28px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16,
        position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
      }}>
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
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Choose the type of proposal you want to create</div>
          </div>
        </div>
        <button
          onClick={() => navigate('/proposals/product?tab=archive&only=archive')}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, background: '#0284c7', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', color: '#fff' }}
        >
          <Search size={16} /> Search Generated Proposals
        </button>
      </header>

      <main style={{ flex: 1, padding: '48px 36px', maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0B2A6F', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Proposal Generator</h2>
        <p style={{ fontSize: '0.9rem', color: '#64748b', margin: '0 0 28px' }}>Select a proposal type to continue.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {OPTIONS.map(opt => {
            const Icon = opt.icon;
            const isHover = hovered === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => navigate(opt.path)}
                onMouseEnter={() => setHovered(opt.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(opt.id)}
                onBlur={() => setHovered(null)}
                style={{
                  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                  background: '#ffffff', border: `1.5px solid ${isHover ? '#0284c7' : '#e2e8f0'}`,
                  borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 14,
                  boxShadow: isHover ? '0 8px 24px rgba(2, 132, 199, 0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
                  transform: isHover ? 'translateY(-2px)' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ width: 48, height: 48, borderRadius: 10, background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)' }}>
                  <Icon size={24} />
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0B2A6F', marginBottom: 4 }}>{opt.title}</div>
                  <div style={{ fontSize: '0.88rem', color: '#64748b', lineHeight: 1.45 }}>{opt.desc}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem', fontWeight: 700, color: '#0284c7', marginTop: 'auto' }}>
                  Open <ChevronRight size={16} />
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

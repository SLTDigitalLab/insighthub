import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Wrench, Sparkles, Quote, ArrowLeft, CheckCircle2, Clock, ShieldCheck, Heart } from 'lucide-react';

export default function ProposalMaintenance({ onBack = null }) {
  const navigate = useNavigate();

  const handleReturn = () => {
    if (onBack) {
      onBack();
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div style={{
      minHeight: '75vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1rem',
      fontFamily: 'Inter, -apple-system, sans-serif'
    }}>
      <div style={{
        maxWidth: '680px',
        width: '100%',
        background: '#ffffff',
        borderRadius: '1.25rem',
        border: '1px solid #e2e8f0',
        boxShadow: '0 20px 40px -15px rgba(2, 132, 199, 0.1), 0 0 1px 1px rgba(0, 0, 0, 0.04)',
        padding: '3rem 2.5rem',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Decorative Top Accent Bar */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '5px',
          background: 'linear-gradient(90deg, #0284c7 0%, #0B2A6F 50%, #10b981 100%)'
        }} />

        {/* Pulsing Icon */}
        <div style={{
          width: '76px',
          height: '76px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.12) 0%, rgba(16, 185, 129, 0.15) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem auto',
          boxShadow: '0 8px 25px rgba(2, 132, 199, 0.18)'
        }}>
          <Wrench size={36} color="#0284c7" />
        </div>

        {/* Status Pill */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#e0f2fe', color: '#0369a1', padding: '4px 14px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 700, marginBottom: '1.25rem' }}>
          <Clock size={14} /> Scheduled System Maintenance
        </div>

        {/* Heading */}
        <h2 style={{ fontSize: '1.65rem', fontWeight: 800, color: '#0B2A6F', margin: '0 0 0.75rem 0', letterSpacing: '-0.02em' }}>
          Proposal Generator is Under Maintenance
        </h2>

        <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: 1.6, maxWidth: '540px', margin: '0 auto 1.75rem auto' }}>
          Our corporate proposal generation engine is currently undergoing system upgrades, template calibration, and performance enhancements. This section is temporarily reserved for system administrators while upgrades are in progress.
        </p>

        {/* Positive Motivating Quote Box */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.04) 0%, rgba(16, 185, 129, 0.06) 100%)',
          border: '1.5px solid rgba(2, 132, 199, 0.2)',
          borderRadius: '1rem',
          padding: '1.5rem 1.75rem',
          margin: '0 auto 2rem auto',
          textAlign: 'left',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#0284c7',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: 2
            }}>
              <Quote size={16} />
            </div>
            <div>
              <p style={{
                fontSize: '0.98rem',
                fontWeight: 600,
                color: '#0f172a',
                lineHeight: 1.6,
                margin: '0 0 0.5rem 0',
                fontStyle: 'italic'
              }}>
                "Patience and persistence are the bridge between goals and great achievements. We are fine-tuning every formula and template behind the scenes so your next sales proposal is nothing short of exceptional. Please hang on — your next big deal awaits!"
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 700, color: '#0369a1' }}>
                <Sparkles size={14} color="#10b981" />
                <span>InsightHub Enterprise AI Team</span>
              </div>
            </div>
          </div>
        </div>

        {/* Operational Status Breakdown */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 10,
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: '2rem',
          textAlign: 'left'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#166534' }}>
            <CheckCircle2 size={15} color="#10b981" />
            <span><strong>Live Lead Scraping:</strong> Active</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#166534' }}>
            <CheckCircle2 size={15} color="#10b981" />
            <span><strong>Meeting Prep & Intel:</strong> Active</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#0369a1' }}>
            <ShieldCheck size={15} color="#0284c7" />
            <span><strong>Proposal Engine:</strong> Admins Only</span>
          </div>
        </div>

        {/* Back Button */}
        <button
          onClick={handleReturn}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 24px',
            borderRadius: 10,
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '0.92rem',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(2, 132, 199, 0.3)',
            transition: 'transform 0.15s ease'
          }}
        >
          <ArrowLeft size={16} /> Return to Sales Dashboard
        </button>
      </div>
    </div>
  );
}

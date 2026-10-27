import React, { useEffect } from 'react';
import { AlertTriangle, Trash2, RotateCcw, FilePlus, X } from 'lucide-react';

/**
 * Modern In-App Confirmation Modal
 * Replaces ugly browser system popups ("localhost:5173 says...") with
 * clean, branded, user-friendly dialogs.
 */
export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary', // 'primary' | 'danger' | 'warning'
  icon = null,
  onConfirm,
  onCancel
}) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel?.();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        // Prevent accidental form submission behind modal
        e.preventDefault();
        onConfirm?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  // Choose appropriate icon if not explicitly passed
  const renderIcon = () => {
    if (icon) return icon;
    if (variant === 'danger') {
      return <Trash2 size={24} color="#ef4444" strokeWidth={2.2} />;
    }
    if (variant === 'warning') {
      return <RotateCcw size={24} color="#d97706" strokeWidth={2.2} />;
    }
    return <FilePlus size={24} color="#0066FF" strokeWidth={2.2} />;
  };

  const badgeBg =
    variant === 'danger'
      ? 'rgba(239, 68, 68, 0.12)'
      : variant === 'warning'
      ? 'rgba(245, 158, 11, 0.14)'
      : 'rgba(0, 102, 255, 0.12)';

  const confirmBtnBg =
    variant === 'danger'
      ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
      : variant === 'warning'
      ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
      : 'linear-gradient(135deg, #0066FF 0%, #0052cc 100%)';

  const confirmBtnShadow =
    variant === 'danger'
      ? '0 4px 14px rgba(239, 68, 68, 0.35)'
      : variant === 'warning'
      ? '0 4px 14px rgba(245, 158, 11, 0.35)'
      : '0 4px 14px rgba(0, 102, 255, 0.35)';

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '1.25rem',
        animation: 'fadeIn 0.18s ease-out'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: '1.1rem',
          maxWidth: '470px',
          width: '100%',
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.9)',
          overflow: 'hidden',
          animation: 'fadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        <div style={{ padding: '1.6rem 1.5rem 1.25rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: badgeBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {renderIcon()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.35 }}>
              {title}
            </h3>
            <div style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: '#475569', lineHeight: 1.55 }}>
              {message}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '0.25rem',
              borderRadius: '0.375rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s ease'
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = '#475569'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = '#94a3b8'; }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            padding: '1rem 1.5rem',
            background: '#f8fafc',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            alignItems: 'center'
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '0.65rem 1.25rem',
              borderRadius: '0.65rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: '#ffffff',
              color: '#475569',
              border: '1px solid #cbd5e1',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = '#f1f5f9';
              e.currentTarget.style.borderColor = '#94a3b8';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.borderColor = '#cbd5e1';
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '0.65rem 1.4rem',
              borderRadius: '0.65rem',
              fontSize: '0.875rem',
              fontWeight: 700,
              background: confirmBtnBg,
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              boxShadow: confirmBtnShadow,
              transition: 'all 0.15s ease',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.opacity = '0.94';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

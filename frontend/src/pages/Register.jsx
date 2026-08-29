import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ShieldCheck, UploadCloud, User, Mail, CreditCard, Hash,
  Camera, CheckCircle, AlertCircle, Loader2, ArrowLeft, Image as ImageIcon,
  X, Sparkles, Clock, Compass, HeartHandshake, Quote
} from 'lucide-react';
import axios from 'axios';

// Curated collection of serene, motivational quotes
const MOTIVATIONAL_QUOTES = [
  {
    quote: "Success is where preparation and opportunity meet.",
    author: "Bobby Unser"
  },
  {
    quote: "Patience is not simply the ability to wait — it's the mindset of striving while the future unfolds.",
    author: "InsightHub Philosophy"
  },
  {
    quote: "The future belongs to those who see possibilities before they become obvious.",
    author: "John Sculley"
  },
  {
    quote: "Great things are not done by impulse, but by a series of small, dedicated actions brought together.",
    author: "Vincent van Gogh"
  },
  {
    quote: "Empowering intelligent conversations, one prospect at a time.",
    author: "SLT Mobitel Enterprise"
  },
  {
    quote: "Quality means doing it right when no one is looking.",
    author: "Henry Ford"
  }
];

const Register = () => {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    nicNumber: '',
    regNumber: ''
  });

  const [nicPhoto, setNicPhoto] = useState(null);
  const [nicPreview, setNicPreview] = useState(null);

  const [facePhoto, setFacePhoto] = useState(null);
  const [facePreview, setFacePreview] = useState(null);

  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Motivational quote rotator
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);
  const [quoteFading, setQuoteFading] = useState(false);

  useEffect(() => {
    if (!submitted) return;
    const interval = setInterval(() => {
      setQuoteFading(true);
      setTimeout(() => {
        setCurrentQuoteIndex((prev) => (prev + 1) % MOTIVATIONAL_QUOTES.length);
        setQuoteFading(false);
      }, 400);
    }, 6000);
    return () => clearInterval(interval);
  }, [submitted]);

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    if (error) setError('');
  };

  const handleNicFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('Please upload a valid image file (PNG, JPG, JPEG) for NIC.');
        return;
      }
      setNicPhoto(file);
      setNicPreview(URL.createObjectURL(file));
      if (error) setError('');
    }
  };

  const handleFaceFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('Please upload a valid image file for user face photo.');
        return;
      }
      setFacePhoto(file);
      setFacePreview(URL.createObjectURL(file));
      if (error) setError('');
    }
  };

  // Webcam capture handlers
  const startCamera = async () => {
    try {
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.warn('Camera error:', err);
      setError('Unable to access webcam. Please upload a face photo from your files.');
      setCameraActive(false);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        const file = new File([blob], `face-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setFacePhoto(file);
        setFacePreview(URL.createObjectURL(blob));
        stopCamera();
      }, 'image/jpeg', 0.95);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
    }
    setCameraActive(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.name.trim() || !formData.email.trim() || !formData.nicNumber.trim() || !formData.regNumber.trim()) {
      setError('Please fill in all required registration fields.');
      return;
    }

    if (!nicPhoto) {
      setError('Please upload a clear photo of your National Identity Card (NIC).');
      return;
    }

    if (!facePhoto) {
      setError('Please provide a clear face photo (selfie or upload).');
      return;
    }

    setLoading(true);

    try {
      const data = new FormData();
      data.append('name', formData.name.trim());
      data.append('email', formData.email.trim());
      data.append('nicNumber', formData.nicNumber.trim());
      data.append('regNumber', formData.regNumber.trim());
      data.append('nicPhoto', nicPhoto);
      data.append('facePhoto', facePhoto);

      const response = await axios.post('/api/auth/register', data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.success) {
        setSubmitted(true);
      } else {
        setError(response.data.error || 'Failed to submit registration request.');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError(err.response?.data?.error || err.message || 'An error occurred during submission.');
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // CALM & MOTIVATIONAL WAITING SCREEN
  // ==========================================
  if (submitted) {
    const activeQuote = MOTIVATIONAL_QUOTES[currentQuoteIndex];

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at top right, #e0f2fe 0%, #f0fdf4 40%, #f8fafc 100%)',
        padding: '2.5rem 1.5rem',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Soft Decorative Ambient Circles */}
        <div style={{
          position: 'absolute', top: '-10%', right: '-5%', width: '400px', height: '400px',
          borderRadius: '50%', background: 'rgba(0, 102, 255, 0.04)', filter: 'blur(60px)', pointerEvents: 'none'
        }} />
        <div style={{
          position: 'absolute', bottom: '-10%', left: '-5%', width: '450px', height: '450px',
          borderRadius: '50%', background: 'rgba(16, 185, 129, 0.05)', filter: 'blur(70px)', pointerEvents: 'none'
        }} />

        <div
          className="animate-fade-in"
          style={{
            background: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(16px)',
            padding: '3.5rem 3rem',
            borderRadius: '1.75rem',
            boxShadow: '0 25px 60px -15px rgba(0, 102, 255, 0.1), 0 0 1px 1px rgba(0, 0, 0, 0.04)',
            width: '100%',
            maxWidth: '580px',
            border: '1px solid rgba(226, 232, 240, 0.9)',
            textAlign: 'center',
            position: 'relative',
            zIndex: 10
          }}
        >
          {/* Calming Pulsing Icon */}
          <div style={{
            width: '76px',
            height: '76px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(0, 102, 255, 0.1) 0%, rgba(16, 185, 129, 0.15) 100%)',
            color: '#0066FF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem auto',
            border: '1px solid rgba(0, 102, 255, 0.2)',
            boxShadow: '0 8px 30px rgba(0, 102, 255, 0.15)'
          }}>
            <Sparkles size={38} style={{ color: '#0066FF' }} />
          </div>

          {/* Calming Header */}
          <h2 style={{
            fontSize: '1.65rem',
            fontWeight: 800,
            color: '#0f172a',
            letterSpacing: '-0.025em',
            marginBottom: '0.6rem'
          }}>
            Your Request is Under Review
          </h2>

          <p style={{
            color: '#475569',
            fontSize: '0.96rem',
            lineHeight: '1.65',
            maxWidth: '460px',
            margin: '0 auto 2rem auto'
          }}>
            Please wait until the administrator reviews and approves your account request. We are verifying your KYC documents.
          </p>

          {/* 3-Step Journey Timeline */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '1rem',
            padding: '1.25rem 1.5rem',
            marginBottom: '2rem',
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '0.85rem' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#10b981', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold' }}>✓</div>
              <div>
                <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0f172a' }}>Application Submitted</span>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0' }}>Identity details & photos registered</p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '0.85rem' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(0, 102, 255, 0.15)', color: '#0066FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold' }}>⏳</div>
              <div>
                <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0066FF' }}>Administrator Verification</span>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0' }}>Pending admin confirmation</p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#f1f5f9', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold' }}>🔒</div>
              <div>
                <span style={{ fontSize: '0.86rem', fontWeight: 600, color: '#94a3b8' }}>Email Activation & Password Creation</span>
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0' }}>Link sent to your inbox upon approval</p>
              </div>
            </div>
          </div>

          {/* Inspirational & Motivational Quote Card */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(0, 102, 255, 0.04) 0%, rgba(16, 185, 129, 0.06) 100%)',
            border: '1px solid rgba(0, 102, 255, 0.15)',
            borderRadius: '1rem',
            padding: '1.5rem',
            marginBottom: '2rem',
            position: 'relative',
            minHeight: '110px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <Quote size={22} style={{ color: '#0066FF', opacity: 0.35, marginBottom: '0.4rem' }} />
            <div style={{
              opacity: quoteFading ? 0 : 1,
              transition: 'opacity 0.4s ease-in-out',
              width: '100%'
            }}>
              <p style={{
                fontSize: '0.94rem',
                fontStyle: 'italic',
                color: '#1e293b',
                lineHeight: '1.55',
                margin: '0 0 0.4rem 0',
                fontWeight: 500
              }}>
                "{activeQuote.quote}"
              </p>
              <span style={{
                fontSize: '0.8rem',
                fontWeight: 700,
                color: '#0066FF',
                letterSpacing: '0.02em'
              }}>
                — {activeQuote.author}
              </span>
            </div>
          </div>

          {/* User Confirmation Summary */}
          <div style={{
            fontSize: '0.82rem',
            color: '#64748b',
            marginBottom: '2rem',
            lineHeight: 1.6
          }}>
            Notification will be sent to <strong>{formData.email}</strong> once approved.
          </div>

          {/* Return Button */}
          <button
            onClick={() => navigate('/login')}
            style={{
              width: '100%',
              padding: '0.95rem',
              borderRadius: '0.85rem',
              border: 'none',
              background: 'linear-gradient(135deg, #0066FF 0%, #10b981 100%)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.95rem',
              cursor: 'pointer',
              boxShadow: '0 4px 18px rgba(0, 102, 255, 0.3)',
              transition: 'transform 0.15s ease'
            }}
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // REGISTRATION FORM
  // ==========================================
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)',
      padding: '2.5rem 1.5rem'
    }}>
      <div style={{
        background: '#ffffff',
        padding: '3rem 2.5rem',
        borderRadius: '1.25rem',
        boxShadow: '0 20px 45px -10px rgba(0, 102, 255, 0.12), 0 0 1px 1px rgba(0, 0, 0, 0.05)',
        width: '100%',
        maxWidth: '560px',
        border: '1px solid #e2e8f0'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.6rem 1.2rem',
            borderRadius: '1rem',
            background: '#ffffff',
            border: '1px solid #f1f5f9',
            boxShadow: '0 8px 25px rgba(0, 102, 255, 0.08)',
            marginBottom: '1rem'
          }}>
            <img
              src="/insighthub-logo.png"
              alt="InsightHub Logo"
              style={{ maxHeight: '80px', maxWidth: '200px', width: 'auto', objectFit: 'contain' }}
            />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
            Request User Access
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.88rem', marginTop: '0.35rem' }}>
            SLT Mobitel Enterprise Sales Intelligence Account Registration
          </p>
        </div>

        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            borderRadius: '0.75rem',
            padding: '0.85rem 1rem',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            marginBottom: '1.5rem'
          }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Full Name */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
              Full Name *
            </label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="e.g. Shalika Hathurusinghe"
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem 0.75rem 2.75rem',
                  borderRadius: '0.75rem',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.92rem',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          {/* Microsoft Work Email */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
              Microsoft Work Email Address *
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="e.g. user@mobitel.lk or corporate email"
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem 0.75rem 2.75rem',
                  borderRadius: '0.75rem',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.92rem',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          {/* Grid: NIC Number & Registration Number */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                NIC Number *
              </label>
              <div style={{ position: 'relative' }}>
                <CreditCard size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  name="nicNumber"
                  value={formData.nicNumber}
                  onChange={handleChange}
                  placeholder="e.g. 199512345678"
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem 0.75rem 2.75rem',
                    borderRadius: '0.75rem',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.92rem',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                Registration No *
              </label>
              <div style={{ position: 'relative' }}>
                <Hash size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  type="text"
                  name="regNumber"
                  value={formData.regNumber}
                  onChange={handleChange}
                  placeholder="e.g. InSP/71xx/xxxx"
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem 0.75rem 2.75rem',
                    borderRadius: '0.75rem',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.92rem',
                    outline: 'none'
                  }}
                />
              </div>
            </div>
          </div>

          {/* NIC Photo Upload */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
              Upload NIC Photo (Front/Back) *
            </label>
            {nicPreview ? (
              <div style={{ position: 'relative', border: '1px solid #cbd5e1', borderRadius: '0.75rem', padding: '0.5rem', background: '#f8fafc', textAlign: 'center' }}>
                <img src={nicPreview} alt="NIC Preview" style={{ maxHeight: '160px', maxWidth: '100%', borderRadius: '0.5rem', objectFit: 'contain' }} />
                <button
                  type="button"
                  onClick={() => { setNicPhoto(null); setNicPreview(null); }}
                  style={{
                    position: 'absolute', top: '8px', right: '8px',
                    background: '#ef4444', color: '#ffffff', border: 'none', borderRadius: '50%',
                    width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <label style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '1.25rem', border: '2px dashed #cbd5e1', borderRadius: '0.75rem',
                background: '#f8fafc', cursor: 'pointer', transition: 'border-color 0.2s'
              }}>
                <UploadCloud size={24} style={{ color: '#0066FF', marginBottom: '0.35rem' }} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a' }}>Click to upload NIC Photo</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>PNG, JPG or JPEG up to 15MB</span>
                <input type="file" accept="image/*" onChange={handleNicFileChange} style={{ display: 'none' }} />
              </label>
            )}
          </div>

          {/* User Face Photo Upload / Camera Capture */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
                Clear Image of User's Face *
              </label>
              {!facePreview && (
                <button
                  type="button"
                  onClick={cameraActive ? stopCamera : startCamera}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    background: cameraActive ? '#ef4444' : 'rgba(0, 102, 255, 0.1)',
                    color: cameraActive ? '#ffffff' : '#0066FF',
                    border: 'none', padding: '0.25rem 0.6rem', borderRadius: '0.5rem',
                    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  <Camera size={14} />
                  {cameraActive ? 'Cancel Camera' : 'Take Selfie'}
                </button>
              )}
            </div>

            {cameraActive && (
              <div style={{ border: '1px solid #cbd5e1', borderRadius: '0.75rem', padding: '0.5rem', background: '#000000', textAlign: 'center', marginBottom: '0.5rem' }}>
                <video ref={videoRef} autoPlay playsInline style={{ width: '100%', maxHeight: '220px', borderRadius: '0.5rem' }} />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <button
                  type="button"
                  onClick={capturePhoto}
                  style={{
                    marginTop: '0.5rem', background: '#10b981', color: '#ffffff',
                    border: 'none', padding: '0.5rem 1.5rem', borderRadius: '0.5rem',
                    fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer'
                  }}
                >
                  📸 Capture Photo
                </button>
              </div>
            )}

            {facePreview ? (
              <div style={{ position: 'relative', border: '1px solid #cbd5e1', borderRadius: '0.75rem', padding: '0.5rem', background: '#f8fafc', textAlign: 'center' }}>
                <img src={facePreview} alt="Face Preview" style={{ maxHeight: '160px', maxWidth: '100%', borderRadius: '0.5rem', objectFit: 'contain' }} />
                <button
                  type="button"
                  onClick={() => { setFacePhoto(null); setFacePreview(null); }}
                  style={{
                    position: 'absolute', top: '8px', right: '8px',
                    background: '#ef4444', color: '#ffffff', border: 'none', borderRadius: '50%',
                    width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : !cameraActive && (
              <label style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '1.25rem', border: '2px dashed #cbd5e1', borderRadius: '0.75rem',
                background: '#f8fafc', cursor: 'pointer', transition: 'border-color 0.2s'
              }}>
                <ImageIcon size={24} style={{ color: '#10b981', marginBottom: '0.35rem' }} />
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f172a' }}>Click to upload Face Photo</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Clear portrait or selfie photo</span>
                <input type="file" accept="image/*" onChange={handleFaceFileChange} style={{ display: 'none' }} />
              </label>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.9rem',
              borderRadius: '0.75rem',
              border: 'none',
              background: 'linear-gradient(135deg, #0066FF 0%, #10b981 100%)',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.98rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 15px rgba(0, 102, 255, 0.3)',
              marginTop: '0.5rem'
            }}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="spin" />
                Submitting KYC Registration...
              </>
            ) : (
              'Submit Registration for Admin Approval'
            )}
          </button>
        </form>

        <div style={{ marginTop: '1.75rem', textAlign: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
          <p style={{ fontSize: '0.88rem', color: '#64748b', margin: 0 }}>
            Already have an approved account?{' '}
            <Link to="/login" style={{ color: '#0066FF', fontWeight: 700, textDecoration: 'none' }}>
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock, Mail } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { loginRequest } from '../authConfig';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const { instance, inProgress } = useMsal();

  const handleLogin = (e) => {
    e.preventDefault();
    // Store user email in localStorage for email notifications and display
    if (email && password) {
      localStorage.setItem('userEmail', email);
      navigate('/dashboard');
    }
  };

  const handleMicrosoftLogin = async () => {
    if (inProgress !== InteractionStatus.None) {
      console.log("Login is currently in progress, please wait.");
      return;
    }
    try {
      await instance.loginRedirect(loginRequest);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'linear-gradient(135deg, var(--bg-color) 0%, #020617 100%)'
    }}>
      <div 
        className="animate-fade-in"
        style={{ 
          background: 'rgba(30, 41, 59, 0.7)',
          backdropFilter: 'blur(10px)',
          padding: '3rem',
          borderRadius: '1rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          width: '100%',
          maxWidth: '400px',
          border: '1px solid var(--border-color)'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            padding: '1rem 1.5rem',
            borderRadius: '1.25rem', 
            background: '#ffffff',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 12px 35px rgba(0, 102, 255, 0.25)',
            marginBottom: '1rem'
          }}>
            <img 
              src="/insighthub-logo.png" 
              alt="InsightHub Logo" 
              style={{ maxHeight: '90px', maxWidth: '260px', width: 'auto', objectFit: 'contain' }} 
            />
          </div>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.25rem', fontSize: '0.85rem', fontWeight: 500 }}>
            Where Intelligence Meets Sales
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ position: 'relative' }}>
            <Mail size={20} style={{ position: 'absolute', top: '50%', left: '1rem', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="email" 
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', paddingLeft: '3rem' }}
            />
          </div>
          
          <div style={{ position: 'relative' }}>
            <Lock size={20} style={{ position: 'absolute', top: '50%', left: '1rem', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="password" 
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%', paddingLeft: '3rem' }}
            />
          </div>

          <button 
            type="submit"
            style={{ 
              background: 'var(--primary)', 
              color: 'white', 
              padding: '0.75rem',
              borderRadius: '0.5rem',
              fontWeight: 'bold',
              marginTop: '1rem',
              transition: 'background 0.2s',
              border: 'none',
              cursor: 'pointer'
            }}
            onMouseOver={(e) => e.target.style.background = 'var(--primary-hover)'}
            onMouseOut={(e) => e.target.style.background = 'var(--primary)'}
          >
            Sign In to Dashboard
          </button>

          <div style={{ textAlign: 'center', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
            or
          </div>

          <button 
            type="button"
            onClick={handleMicrosoftLogin}
            style={{ 
              background: '#0078D4', // Microsoft Blue
              color: 'white', 
              padding: '0.75rem',
              borderRadius: '0.5rem',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'background 0.2s',
              border: 'none',
              cursor: 'pointer'
            }}
            onMouseOver={(e) => e.target.style.background = '#005a9e'}
            onMouseOut={(e) => e.target.style.background = '#0078D4'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 21 21">
                <path fill="#f3f3f3" d="M0 0h10v10H0zm11 0h10v10H11zM0 11h10v10H0zm11 0h10v10H11z"/>
                <path fill="#f35325" d="M0 0h10v10H0z"/>
                <path fill="#81bc06" d="M11 0h10v10H11z"/>
                <path fill="#05a6f0" d="M0 11h10v10H0z"/>
                <path fill="#ffba08" d="M11 11h10v10H11z"/>
            </svg>
            Sign in with Microsoft
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;

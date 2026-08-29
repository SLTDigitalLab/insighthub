import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BusinessDetail from './pages/BusinessDetail';
import Register from './pages/Register';
import SetPassword from './pages/SetPassword';
import AdminPortal from './pages/AdminPortal';
import ApprovalAction from './pages/ApprovalAction';
import './index.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/set-password" element={<SetPassword />} />
        <Route path="/admin" element={<AdminPortal />} />
        <Route path="/approval-action" element={<ApprovalAction />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/business/:companyName" element={<BusinessDetail />} />
      </Routes>
    </Router>
  );
}

export default App;

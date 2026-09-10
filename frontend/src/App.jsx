import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BusinessDetail from './pages/BusinessDetail';
import RequestAccess from './pages/RequestAccess';
import AdminPortal from './pages/AdminPortal';
import ApprovalAction from './pages/ApprovalAction';
import SearchHistory from './pages/SearchHistory';
import ProtectedRoute from './components/ProtectedRoute';
import './index.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/request-access" element={<RequestAccess />} />
        <Route path="/register" element={<Navigate to="/request-access" replace />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin={true}>
              <AdminPortal />
            </ProtectedRoute>
          }
        />
        <Route path="/approval-action" element={<ApprovalAction />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/search-history"
          element={
            <ProtectedRoute>
              <SearchHistory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/business/:companyName"
          element={
            <ProtectedRoute>
              <BusinessDetail />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;

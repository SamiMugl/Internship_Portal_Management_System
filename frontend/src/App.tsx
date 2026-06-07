import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import { ErrorBoundary } from './components/ErrorBoundary'
import Login from './pages/Login'
import Register from './pages/Register'
import Listings from './pages/Listings'
import MyApplications from './pages/MyApplications'
import StudentProfile from './pages/StudentProfile'
import EmployerListings from './pages/EmployerListings'
import EmployerApplications from './pages/EmployerApplications'
import EmployerProfile from './pages/EmployerProfile'
import AdminDashboard from './pages/AdminDashboard'
import AdminEmployers from './pages/AdminEmployers'
import AdminListings from './pages/AdminListings'
import AdminStudents from './pages/AdminStudents'
import AdminApplications from './pages/AdminApplications'
import AuditLog from './pages/AuditLog'
import Notifications from './pages/Notifications'

function ProtectedRoute({ children, roles }: { children: React.ReactElement; roles?: string[] }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <div className="flex items-center justify-center h-screen text-gray-500">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  const { user } = useAuth()

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gray-50">
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Home redirect */}
          <Route path="/" element={
            user ? (
              user.role === 'admin' ? <Navigate to="/admin/dashboard" /> :
              user.role === 'employer' ? <Navigate to="/employer/listings" /> :
              <Navigate to="/listings" />
            ) : <Navigate to="/login" />
          } />

          {/* Student routes */}
          <Route path="/listings" element={<ProtectedRoute roles={['student']}><Listings /></ProtectedRoute>} />
          <Route path="/my-applications" element={<ProtectedRoute roles={['student']}><MyApplications /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute roles={['student']}><StudentProfile /></ProtectedRoute>} />

          {/* Employer routes */}
          <Route path="/employer/listings" element={<ProtectedRoute roles={['employer']}><EmployerListings /></ProtectedRoute>} />
          <Route path="/employer/listings/:listingId/applications" element={<ProtectedRoute roles={['employer']}><EmployerApplications /></ProtectedRoute>} />
          <Route path="/employer/profile" element={<ProtectedRoute roles={['employer']}><EmployerProfile /></ProtectedRoute>} />

          {/* Admin routes */}
          <Route path="/admin/dashboard" element={<ProtectedRoute roles={['admin']}><ErrorBoundary><AdminDashboard /></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/employers" element={<ProtectedRoute roles={['admin']}><ErrorBoundary><AdminEmployers /></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/listings" element={<ProtectedRoute roles={['admin']}><ErrorBoundary><AdminListings /></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/students" element={<ProtectedRoute roles={['admin']}><ErrorBoundary><AdminStudents /></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/applications" element={<ProtectedRoute roles={['admin']}><ErrorBoundary><AdminApplications /></ErrorBoundary></ProtectedRoute>} />
          <Route path="/admin/audit-log" element={<ProtectedRoute roles={['admin']}><ErrorBoundary><AuditLog /></ErrorBoundary></ProtectedRoute>} />

          {/* Shared */}
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />

          {/* 404 */}
          <Route path="*" element={<div className="flex items-center justify-center h-96 text-gray-500 text-xl">404 — Page not found</div>} />
        </Routes>
      </main>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

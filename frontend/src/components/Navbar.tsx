import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = async () => {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken) {
      try { await api.post('/auth/logout', { refreshToken }) } catch { }
    }
    logout()
    navigate('/login')
  }

  const isActive = (path: string) =>
    location.pathname === path
      ? 'bg-white/20 text-white font-bold'
      : 'text-white/80 hover:bg-white/10 hover:text-white'

  const studentLinks = [
    { to: '/listings', label: '🔍 Browse Internships' },
    { to: '/my-applications', label: '📋 My Applications' },
    { to: '/profile', label: '👤 My Profile' },
  ]

  const employerLinks = [
    { to: '/employer/listings', label: '💼 My Listings' },
    { to: '/employer/profile', label: '🏢 Company Profile' },
  ]

  const adminLinks = [
    { to: '/admin/dashboard', label: '📊 Dashboard' },
    { to: '/admin/employers', label: '🏢 Employers' },
    { to: '/admin/listings', label: '📋 Listings' },
    { to: '/admin/students', label: '🎓 Students' },
    { to: '/admin/applications', label: '📝 Applications' },
    { to: '/admin/audit-log', label: '📜 Audit Log' },
  ]

  const links =
    user?.role === 'student' ? studentLinks :
    user?.role === 'employer' ? employerLinks :
    user?.role === 'admin' ? adminLinks : []

  return (
    <nav className="sticky top-0 z-50 gradient-bg shadow-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
            <div className="bg-white/20 group-hover:bg-white/30 rounded-xl p-2 transition-all duration-200">
              <span className="text-xl">🎓</span>
            </div>
            <span className="text-white font-black text-xl tracking-tight hidden sm:block">
              Internship<span className="text-yellow-300">Portal</span>
            </span>
          </Link>

          {/* Desktop Links */}
          {user && (
            <div className="hidden md:flex items-center gap-1">
              {links.map(l => (
                <Link key={l.to} to={l.to}
                  className={`px-3 py-2 rounded-xl text-sm transition-all duration-200 font-medium ${isActive(l.to)}`}>
                  {l.label}
                </Link>
              ))}
            </div>
          )}

          {/* Right side */}
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <Link to="/notifications"
                  className="bg-white/10 hover:bg-white/20 p-2 rounded-xl transition-all duration-200 text-lg">
                  🔔
                </Link>
                <div className="hidden sm:flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-xl">
                  <div className="w-7 h-7 bg-yellow-400 rounded-full flex items-center justify-center font-black text-sm text-gray-800">
                    {user.email[0].toUpperCase()}
                  </div>
                  <span className="text-white/90 text-sm font-medium max-w-[150px] truncate">{user.email}</span>
                </div>
                <button onClick={handleLogout}
                  className="bg-red-500/80 hover:bg-red-500 text-white px-3 py-2 rounded-xl text-sm font-bold transition-all duration-200">
                  🚪 <span className="hidden sm:inline">Logout</span>
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-white/80 hover:text-white text-sm font-medium transition px-2">
                  Login
                </Link>
                <Link to="/register"
                  className="bg-white text-purple-700 hover:bg-yellow-300 hover:text-purple-800 px-4 py-2 rounded-xl text-sm font-black transition-all duration-200 shadow-md">
                  Get Started
                </Link>
              </>
            )}
            {user && (
              <button onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden text-white p-2 bg-white/10 rounded-xl text-lg font-bold">
                {menuOpen ? '✕' : '☰'}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Menu */}
        {menuOpen && user && (
          <div className="md:hidden py-3 border-t border-white/20 animate-slide-up">
            {links.map(l => (
              <Link key={l.to} to={l.to} onClick={() => setMenuOpen(false)}
                className={`block px-4 py-3 rounded-xl text-sm my-0.5 transition-all duration-200 font-medium ${isActive(l.to)}`}>
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}

import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      // Clear any stale tokens from previous sessions before setting new ones
      localStorage.clear()
      login(data.accessToken, data.refreshToken)
      const payload = JSON.parse(atob(data.accessToken.split('.')[1]))
      if (payload.role === 'admin') navigate('/admin/dashboard')
      else if (payload.role === 'employer') navigate('/employer/listings')
      else navigate('/listings')
    } catch (err: any) {
      const code = err.response?.data?.error?.code
      const msg = err.response?.data?.error?.message
      if (code === 'ACCOUNT_LOCKED') setError('Account locked due to too many failed attempts. Please try again later.')
      else if (code === 'ACCOUNT_NOT_VERIFIED') setError('Please verify your email address before logging in. Check your inbox for the verification link.')
      else if (code === 'ACCOUNT_PENDING_APPROVAL') setError('Your employer account is pending administrator approval. Please wait 1-2 business days, or ask admin to approve your account. (Admin: admin@portal.com / Admin@1234)')
      else setError(msg || 'Invalid email or password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Left Panel */}
      <div className="hidden lg:flex flex-1 gradient-bg items-center justify-center p-12">
        <div className="text-white max-w-md animate-fade-in">
          <div className="text-6xl mb-8">🎓</div>
          <h1 className="text-4xl font-bold mb-4 leading-tight">Find Your Perfect Internship</h1>
          <p className="text-white/80 text-lg leading-relaxed mb-10">
            Connect with top companies, build your career, and gain real-world experience through our platform.
          </p>
          <div className="space-y-4">
            {[
              { icon: '✅', text: '500+ Active Internship Opportunities' },
              { icon: '✅', text: '200+ Verified Companies & Employers' },
              { icon: '✅', text: '10,000+ Students Successfully Placed' },
            ].map(item => (
              <div key={item.text} className="flex items-center gap-3">
                <span className="text-yellow-400 font-bold">{item.icon}</span>
                <span className="text-white/90 font-medium">{item.text}</span>
              </div>
            ))}
          </div>
          <div className="mt-10 p-5 bg-white/10 rounded-2xl border border-white/20">
            <p className="text-white/60 text-xs uppercase tracking-wider mb-2 font-bold">Demo Admin Login</p>
            <p className="text-white font-mono text-sm">admin@portal.com</p>
            <p className="text-white font-mono text-sm">Admin@1234</p>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md animate-slide-up">
          <div className="text-center mb-8">
            <div className="text-5xl mb-4">👋</div>
            <h2 className="text-3xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-gray-500 mt-2">Sign in to your account to continue</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl mb-6 text-sm font-medium flex items-start gap-2">
              <span>⚠️</span> <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Email Address</label>
              <input type="email" required value={form.email} placeholder="you@example.com"
                onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl bg-white focus:outline-none focus:border-purple-500 transition-all text-sm font-medium" />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Password</label>
              <input type="password" required value={form.password} placeholder="Enter your password"
                onChange={e => setForm({ ...form, password: e.target.value })}
                className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl bg-white focus:outline-none focus:border-purple-500 transition-all text-sm font-medium" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full gradient-bg text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-purple-200 text-base">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"></span>
                  Signing in...
                </span>
              ) : 'Sign In →'}
            </button>
          </form>

          <div className="mt-8 p-4 bg-gray-50 rounded-2xl border border-gray-200 lg:hidden">
            <p className="text-xs text-gray-500 font-bold mb-2 uppercase tracking-wide">Demo Admin</p>
            <p className="text-sm text-gray-700 font-mono">admin@portal.com</p>
            <p className="text-sm text-gray-700 font-mono">Admin@1234</p>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-purple-600 font-bold hover:text-purple-700">Create one free →</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

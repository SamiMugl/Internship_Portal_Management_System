import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../api/client'

export default function Register() {
  const navigate = useNavigate()
  const [role, setRole] = useState<'student' | 'employer'>('student')
  const [form, setForm] = useState({
    email: '', password: '', fullName: '', institution: '', degree: '',
    companyName: '', industry: '', contactPerson: ''
  })
  const [error, setError] = useState('')
  const [successType, setSuccessType] = useState<'student' | 'employer' | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (role === 'student') {
        await api.post('/auth/register/student', {
          email: form.email, password: form.password,
          fullName: form.fullName, institution: form.institution, degree: form.degree
        })
        setSuccessType('student')
      } else {
        await api.post('/auth/register/employer', {
          email: form.email, password: form.password,
          companyName: form.companyName, industry: form.industry,
          contactPerson: form.contactPerson
        })
        setSuccessType('employer')
      }
    } catch (err: any) {
      const code = err.response?.data?.error?.code
      if (code === 'DUPLICATE_EMAIL') setError('An account with this email already exists. Please login instead.')
      else setError(err.response?.data?.error?.message || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Student success screen ────────────────────────────────────────────────
  if (successType === 'student') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-10 max-w-md w-full text-center animate-scale-in">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Account Created!</h2>
          <p className="text-gray-600 mb-6">Your student account has been created successfully.</p>
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-left mb-6">
            <p className="font-bold text-blue-800 mb-3">📧 Next Steps:</p>
            <ol className="space-y-2 text-sm text-blue-700">
              <li className="flex items-start gap-2"><span className="font-bold">1.</span> Check your email inbox for a verification link</li>
              <li className="flex items-start gap-2"><span className="font-bold">2.</span> Click the link to verify your email address</li>
              <li className="flex items-start gap-2"><span className="font-bold">3.</span> Come back and login with your credentials</li>
            </ol>
          </div>
          <p className="text-xs text-gray-400 mb-6">Don't see the email? Check your spam/junk folder.</p>
          <button onClick={() => navigate('/login')}
            className="w-full gradient-bg text-white py-3 rounded-2xl font-bold hover:opacity-90 transition-all">
            Go to Login →
          </button>
        </div>
      </div>
    )
  }

  // ── Employer success screen ───────────────────────────────────────────────
  if (successType === 'employer') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-10 max-w-md w-full text-center animate-scale-in">
          <div className="text-6xl mb-4">⏳</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Account Submitted!</h2>
          <p className="text-gray-600 mb-6">Your employer account has been created and is pending admin approval.</p>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-left mb-6">
            <p className="font-bold text-amber-800 mb-3">📋 What happens next:</p>
            <ol className="space-y-2 text-sm text-amber-700">
              <li className="flex items-start gap-2"><span className="font-bold">1.</span> An admin will review your company registration</li>
              <li className="flex items-start gap-2"><span className="font-bold">2.</span> Approval usually takes 1–2 business days</li>
              <li className="flex items-start gap-2"><span className="font-bold">3.</span> You'll receive an email once approved</li>
              <li className="flex items-start gap-2"><span className="font-bold">4.</span> After approval, you can login and post listings</li>
            </ol>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 mb-6">
            <p className="text-sm text-purple-700 font-semibold">💡 For demo/testing:</p>
            <p className="text-xs text-purple-600 mt-1">Login as admin (<strong>admin@portal.com</strong> / <strong>Admin@1234</strong>) and approve your account from the Employers page.</p>
          </div>
          <button onClick={() => navigate('/login')}
            className="w-full gradient-bg text-white py-3 rounded-2xl font-bold hover:opacity-90 transition-all">
            Go to Login →
          </button>
        </div>
      </div>
    )
  }

  // ── Registration form ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto animate-slide-up">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🎓</div>
          <h1 className="text-3xl font-bold text-gray-900">Create your account</h1>
          <p className="text-gray-500 mt-2">Join thousands of students and companies</p>
        </div>

        {/* Role Toggle */}
        <div className="flex p-1.5 bg-gray-100 rounded-2xl mb-6 shadow-inner">
          <button type="button" onClick={() => setRole('student')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all duration-200 ${role === 'student' ? 'gradient-bg text-white shadow-md' : 'text-gray-500 hover:text-gray-700'}`}>
            🎓 Student
          </button>
          <button type="button" onClick={() => setRole('employer')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all duration-200 ${role === 'employer' ? 'gradient-bg text-white shadow-md' : 'text-gray-500 hover:text-gray-700'}`}>
            🏢 Employer
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl mb-5 text-sm font-medium">
            ⚠️ {error}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-5">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Email Address</label>
            <input type="email" required value={form.email} placeholder="you@gmail.com"
              onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-purple-500 transition-all text-sm" />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">Password</label>
            <input type="password" required minLength={8} value={form.password} placeholder="Minimum 8 characters"
              onChange={e => setForm({ ...form, password: e.target.value })}
              className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-purple-500 transition-all text-sm" />
          </div>

          {role === 'student' && (
            <>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Full Name</label>
                <input type="text" required value={form.fullName} placeholder="John Doe"
                  onChange={e => setForm({ ...form, fullName: e.target.value })}
                  className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-purple-500 transition-all text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Institution</label>
                  <input type="text" value={form.institution} placeholder="University name"
                    onChange={e => setForm({ ...form, institution: e.target.value })}
                    className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-purple-500 transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Degree</label>
                  <input type="text" value={form.degree} placeholder="e.g. BS CS"
                    onChange={e => setForm({ ...form, degree: e.target.value })}
                    className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-purple-500 transition-all text-sm" />
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
                📧 A verification email will be sent. Please use a real email address.
              </div>
            </>
          )}

          {role === 'employer' && (
            <>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Company Name</label>
                <input type="text" required value={form.companyName} placeholder="Acme Corporation"
                  onChange={e => setForm({ ...form, companyName: e.target.value })}
                  className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-purple-500 transition-all text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Industry</label>
                  <input type="text" value={form.industry} placeholder="e.g. Technology"
                    onChange={e => setForm({ ...form, industry: e.target.value })}
                    className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-purple-500 transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Contact Person</label>
                  <input type="text" required value={form.contactPerson} placeholder="HR Manager name"
                    onChange={e => setForm({ ...form, contactPerson: e.target.value })}
                    className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-purple-500 transition-all text-sm" />
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-sm text-amber-700">
                ⏳ Your account needs admin approval before you can login. An admin will review within 1–2 business days.
              </div>
            </>
          )}

          <button type="button" onClick={handleSubmit} disabled={loading}
            className="w-full gradient-bg text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-purple-200 disabled:opacity-50 text-base">
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"></span>
                Creating account...
              </span>
            ) : 'Create Account →'}
          </button>
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          Already have an account?{' '}
          <Link to="/login" className="text-purple-600 font-bold hover:text-purple-700">Sign in here →</Link>
        </p>
      </div>
    </div>
  )
}

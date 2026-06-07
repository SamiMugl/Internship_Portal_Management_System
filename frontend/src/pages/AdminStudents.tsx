import { useEffect, useState } from 'react'
import api from '../api/client'

interface Student {
  id: string
  email: string
  status: string
  created_at: string
  full_name?: string | null
  institution?: string | null
  completion_pct?: string | number | null
}

export default function AdminStudents() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const fetchStudents = () => {
    setLoading(true)
    api.get('/admin/students')
      .then(r => {
        // Handle { data: [...] } or plain array
        const raw = r.data
        if (Array.isArray(raw)) setStudents(raw)
        else if (raw && Array.isArray(raw.data)) setStudents(raw.data)
        else setStudents([])
      })
      .catch(() => setStudents([]))
      .finally(() => setLoading(false))
  }

  useEffect(fetchStudents, [])

  const deactivate = async (id: string) => {
    if (!confirm('Deactivate this student account?')) return
    try {
      await api.post(`/admin/accounts/${id}/deactivate`)
      setMsg({ text: 'Student account deactivated.', type: 'success' })
      setTimeout(() => setMsg(null), 3000)
      fetchStudents()
    } catch (e: any) {
      setMsg({ text: e.response?.data?.error?.message || 'Failed', type: 'error' })
      setTimeout(() => setMsg(null), 3000)
    }
  }

  const statusBadge: Record<string, string> = {
    active: 'bg-green-100 text-green-700 border-green-200',
    pending_verification: 'bg-amber-100 text-amber-700 border-amber-200',
    deactivated: 'bg-red-100 text-red-700 border-red-200',
  }

  const filtered = students.filter(s =>
    (s.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.institution || '').toLowerCase().includes(search.toLowerCase())
  )

  const pct = (val: string | number | null | undefined) => {
    if (val == null) return null
    return typeof val === 'string' ? parseFloat(val) : val
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="gradient-bg text-white px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <p className="text-white/70 text-sm mb-1 uppercase tracking-wide">Admin Panel</p>
          <h1 className="text-4xl font-bold">Student Accounts</h1>
          <p className="text-white/70 mt-2">
            View and manage all registered student accounts
            {!loading && <span className="ml-2 bg-white/20 px-2 py-0.5 rounded-full text-sm">{students.length} total</span>}
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {msg && (
          <div className={`mb-5 p-4 rounded-xl border text-sm font-semibold ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}

        <div className="relative mb-6">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input
            placeholder="Search by name, email, or institution..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-5xl mb-4">🎓</p>
            <p className="font-semibold text-lg">No students found</p>
            <p className="text-sm mt-1">{students.length === 0 ? 'No students registered yet.' : 'Try adjusting your search.'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 font-bold">
                <tr>
                  <th className="px-5 py-4 text-left">Student</th>
                  <th className="px-5 py-4 text-left">Institution</th>
                  <th className="px-5 py-4 text-left">Profile %</th>
                  <th className="px-5 py-4 text-left">Status</th>
                  <th className="px-5 py-4 text-left">Joined</th>
                  <th className="px-5 py-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const completionPct = pct(s.completion_pct)
                  return (
                    <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 gradient-bg rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                            {(s.full_name?.[0] || s.email?.[0] || '?').toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-800">{s.full_name || '—'}</p>
                            <p className="text-xs text-gray-500">{s.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-gray-600">{s.institution || '—'}</td>
                      <td className="px-5 py-3">
                        {completionPct != null ? (
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${completionPct >= 60 ? 'bg-green-500' : 'bg-amber-400'}`}
                                style={{ width: `${Math.min(completionPct, 100)}%` }}
                              ></div>
                            </div>
                            <span className="text-xs text-gray-500">{completionPct}%</span>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${statusBadge[s.status] || 'bg-gray-100 text-gray-600'}`}>
                          {s.status === 'active' ? '✅ Active'
                            : s.status === 'pending_verification' ? '⏳ Unverified'
                            : '❌ Deactivated'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-400 text-xs">
                        {new Date(s.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-5 py-3">
                        {s.status === 'active' && (
                          <button
                            onClick={() => deactivate(s.id)}
                            className="text-xs text-red-600 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-xl font-semibold transition-all"
                          >
                            Deactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

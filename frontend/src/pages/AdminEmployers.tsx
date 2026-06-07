import { useEffect, useState } from 'react'
import api from '../api/client'

interface Employer {
  id: string
  // backend returns camelCase
  companyName?: string
  company_name?: string
  industry?: string
  approvalStatus?: string
  approval_status?: string
  contactPerson?: string
  contact_person?: string
  email?: string
  user?: { email: string }
}

export default function AdminEmployers() {
  const [employers, setEmployers] = useState<Employer[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [search, setSearch] = useState('')
  const [processing, setProcessing] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

  const fetchEmployers = () => {
    api.get('/admin/employers')
      .then(r => setEmployers(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(fetchEmployers, [])

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 3000)
  }

  const approve = async (id: string) => {
    setProcessing(id)
    try {
      await api.post(`/admin/employers/${id}/approve`)
      showMsg('Employer approved successfully! They can now login.', 'success')
      fetchEmployers()
    } catch (e: any) {
      showMsg(e.response?.data?.error?.message || 'Failed to approve', 'error')
    } finally { setProcessing(null) }
  }

  const reject = async (id: string) => {
    const reason = prompt('Please provide a reason for rejection:')
    if (!reason?.trim()) return
    setProcessing(id)
    try {
      await api.post(`/admin/employers/${id}/reject`, { reason })
      showMsg('Employer rejected.', 'success')
      fetchEmployers()
    } catch (e: any) {
      showMsg(e.response?.data?.error?.message || 'Failed to reject', 'error')
    } finally { setProcessing(null) }
  }

  // Helper: get field regardless of casing
  const getName = (e: Employer) => e.companyName ?? e.company_name ?? ''
  const getStatus = (e: Employer) => e.approvalStatus ?? e.approval_status ?? ''
  const getContact = (e: Employer) => e.contactPerson ?? e.contact_person ?? ''
  const getEmail = (e: Employer) => e.email ?? e.user?.email ?? ''

  const statusBadge: Record<string, string> = {
    pending:  'bg-amber-100 text-amber-700 border border-amber-200',
    approved: 'bg-green-100 text-green-700 border border-green-200',
    rejected: 'bg-red-100 text-red-700 border border-red-200',
  }

  const statusEmoji: Record<string, string> = {
    pending: '⏳', approved: '✅', rejected: '❌'
  }

  const filtered = employers
    .filter(e => filter === 'all' || getStatus(e) === filter)
    .filter(e => {
      const q = search.toLowerCase()
      return getName(e).toLowerCase().includes(q) || getEmail(e).toLowerCase().includes(q)
    })

  const counts = {
    all: employers.length,
    pending: employers.filter(e => getStatus(e) === 'pending').length,
    approved: employers.filter(e => getStatus(e) === 'approved').length,
    rejected: employers.filter(e => getStatus(e) === 'rejected').length,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="gradient-bg text-white px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <p className="text-white/70 text-sm mb-1 tracking-wide uppercase">Admin Panel</p>
          <h1 className="text-4xl font-bold">Employer Accounts</h1>
          <p className="text-white/70 mt-2">Review and manage company registrations</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {msg && (
          <div className={`mb-5 p-4 rounded-xl border text-sm font-medium flex items-center gap-2 ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {msg.type === 'success' ? '✅' : '❌'} {msg.text}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 mb-5 flex-wrap">
          {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${filter === f ? 'gradient-bg text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {f === 'all' ? '📋' : statusEmoji[f]} {f.charAt(0).toUpperCase() + f.slice(1)}
              <span className="ml-2 bg-black/10 px-2 py-0.5 rounded-full text-xs">{counts[f]}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input placeholder="Search by company name or email..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.length === 0 && (
              <div className="text-center py-20 text-gray-400">
                <p className="text-5xl mb-4">🏢</p>
                <p className="font-semibold text-lg">No employers found</p>
                <p className="text-sm mt-1">Try changing the filter or search term</p>
              </div>
            )}
            {filtered.map(emp => {
              const name = getName(emp)
              const status = getStatus(emp)
              const email = getEmail(emp)
              const contact = getContact(emp)

              return (
                <div key={emp.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 card-hover">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 gradient-bg rounded-2xl flex items-center justify-center text-white font-bold text-xl flex-shrink-0 shadow-md">
                        {(name?.[0] ?? '?').toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-xl">{name || 'Unknown Company'}</h3>
                        <div className="flex flex-wrap gap-3 mt-1.5 text-sm text-gray-500">
                          {emp.industry && <span>🏭 {emp.industry}</span>}
                          {email && <span>✉️ {email}</span>}
                          {contact && <span>👤 {contact}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`text-xs font-bold px-3 py-1.5 rounded-full capitalize ${statusBadge[status] || statusBadge.pending}`}>
                        {statusEmoji[status] || '⏳'} {status || 'pending'}
                      </span>
                      {status === 'pending' && (
                        <>
                          <button onClick={() => approve(emp.id)} disabled={processing === emp.id}
                            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 shadow-sm">
                            ✓ Approve
                          </button>
                          <button onClick={() => reject(emp.id)} disabled={processing === emp.id}
                            className="flex items-center gap-1.5 bg-white hover:bg-red-50 text-red-600 border border-red-200 px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50">
                            ✕ Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

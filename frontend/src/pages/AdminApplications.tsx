import { useEffect, useState } from 'react'
import api from '../api/client'

interface Application {
  id: string
  status: string
  submitted_at: string
  student_name: string
  student_email: string
  listing_title: string
  company_name: string
}

const statusBadge: Record<string, string> = {
  Submitted:           'bg-amber-50 text-amber-700 border-amber-200',
  Under_Review:        'bg-blue-50 text-blue-700 border-blue-200',
  Shortlisted:         'bg-purple-50 text-purple-700 border-purple-200',
  Interview_Scheduled: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Offered:             'bg-green-50 text-green-700 border-green-200',
  Accepted:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  Rejected:            'bg-red-50 text-red-700 border-red-200',
  Withdrawn:           'bg-gray-50 text-gray-600 border-gray-200',
}

const statusLabel: Record<string, string> = {
  Submitted: '⏳ Awaiting',
  Under_Review: '🔍 Under Review',
  Shortlisted: '⭐ Shortlisted',
  Interview_Scheduled: '📅 Interview',
  Offered: '🎁 Offered',
  Accepted: '✅ Accepted',
  Rejected: '❌ Rejected',
  Withdrawn: '↩️ Withdrawn',
}

export default function AdminApplications() {
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  useEffect(() => {
    api.get('/admin/applications')
      .then(r => setApps(r.data.data || r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const allStatuses = ['all', 'Submitted', 'Under_Review', 'Shortlisted', 'Interview_Scheduled', 'Offered', 'Accepted', 'Rejected', 'Withdrawn']

  const filtered = apps
    .filter(a => filterStatus === 'all' || a.status === filterStatus)
    .filter(a =>
      (a.student_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (a.student_email || '').toLowerCase().includes(search.toLowerCase()) ||
      (a.listing_title || '').toLowerCase().includes(search.toLowerCase()) ||
      (a.company_name || '').toLowerCase().includes(search.toLowerCase())
    )

  const counts = allStatuses.reduce((acc, s) => {
    acc[s] = s === 'all' ? apps.length : apps.filter(a => a.status === s).length
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="gradient-bg text-white px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <p className="text-white/70 text-sm mb-1 uppercase tracking-wide">Admin Panel</p>
          <h1 className="text-4xl font-bold">All Applications</h1>
          <p className="text-white/70 mt-2">Monitor all internship applications across the platform</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          {allStatuses.filter(s => s !== 'all').map(s => (
            <button key={s} onClick={() => setFilterStatus(s === filterStatus ? 'all' : s)}
              className={`p-3 rounded-xl text-xs font-bold text-center transition-all ${filterStatus === s ? 'gradient-bg text-white shadow-md' : 'bg-white border border-gray-100 text-gray-600 hover:bg-gray-50'}`}>
              <p className="text-xl font-black">{counts[s]}</p>
              <p className="mt-0.5 truncate">{s.replace('_', ' ')}</p>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input placeholder="Search by student, listing, or company..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm" />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-500">
              Showing {filtered.length} of {apps.length} applications
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-left">Student</th>
                  <th className="px-5 py-3 text-left">Position</th>
                  <th className="px-5 py-3 text-left">Company</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-left">Applied</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10 text-gray-400">No applications found</td></tr>
                )}
                {filtered.map(app => (
                  <tr key={app.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gray-800">{app.student_name || '—'}</p>
                      <p className="text-xs text-gray-500">{app.student_email}</p>
                    </td>
                    <td className="px-5 py-3 text-gray-700 font-medium">{app.listing_title}</td>
                    <td className="px-5 py-3 text-gray-600">{app.company_name}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-bold px-3 py-1 rounded-full border ${statusBadge[app.status] || 'bg-gray-100 text-gray-600'}`}>
                        {statusLabel[app.status] || app.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(app.submitted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

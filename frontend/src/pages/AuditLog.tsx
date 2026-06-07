import { useEffect, useState } from 'react'
import api from '../api/client'

interface AuditEntry {
  id: string
  action: string
  targetType?: string
  target_type?: string
  targetId?: string
  target_id?: string
  reason: string
  timestamp: string
  adminEmail?: string
  admin_email?: string
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/admin/audit-log')
      .then(r => {
        // Handle both { data: [...] } and plain array responses
        const raw = r.data?.data ?? r.data ?? []
        setEntries(Array.isArray(raw) ? raw : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="gradient-bg text-white px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <p className="text-white/70 text-sm mb-1 tracking-wide uppercase">Admin Panel</p>
          <h1 className="text-4xl font-bold">Audit Log</h1>
          <p className="text-white/70 mt-2">Complete history of all administrative actions</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 font-bold">
                <tr>
                  <th className="px-5 py-4 text-left">Action</th>
                  <th className="px-5 py-4 text-left">Target</th>
                  <th className="px-5 py-4 text-left">Admin</th>
                  <th className="px-5 py-4 text-left">Reason</th>
                  <th className="px-5 py-4 text-left">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-gray-400">
                      <p className="text-3xl mb-2">📜</p>
                      No audit entries yet.
                    </td>
                  </tr>
                )}
                {entries.map(e => {
                  // Handle both camelCase and snake_case from API
                  const targetType = e.targetType ?? e.target_type ?? ''
                  const targetId   = e.targetId   ?? e.target_id   ?? ''
                  const adminEmail = e.adminEmail  ?? e.admin_email ?? ''
                  const shortId    = targetId ? targetId.slice(0, 8) + '...' : '—'

                  return (
                    <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-semibold text-gray-800">
                        <span className={`inline-block px-2 py-1 rounded-lg text-xs font-bold ${
                          e.action.includes('APPROVE') ? 'bg-green-100 text-green-700' :
                          e.action.includes('REJECT')  ? 'bg-red-100 text-red-700' :
                          e.action.includes('DEACT')   ? 'bg-orange-100 text-orange-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {e.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {targetType && <span className="font-medium text-gray-700">{targetType}</span>}
                        {targetType && targetId && ': '}
                        <span className="font-mono text-xs">{shortId}</span>
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{adminEmail || '—'}</td>
                      <td className="px-5 py-3 text-gray-500">{e.reason || '—'}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs">
                        {e.timestamp ? new Date(e.timestamp).toLocaleString('en-US', {
                          year: 'numeric', month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        }) : '—'}
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

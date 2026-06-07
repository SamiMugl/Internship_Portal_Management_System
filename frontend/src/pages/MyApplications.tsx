import { useEffect, useState } from 'react'
import api from '../api/client'

// Backend returns flat fields from getApplicationsByStudent
interface Application {
  id: string
  status: string
  submitted_at: string
  // Flat fields from JOIN
  listing_title?: string
  title?: string
  location?: string
  company_name?: string
}

const statusConfig: Record<string, { badge: string; label: string; emoji: string; desc: string }> = {
  Submitted: {
    badge: 'bg-amber-50 text-amber-700 border-amber-300',
    label: 'Awaiting Review',
    emoji: '⏳',
    desc: 'Your application has been submitted and is waiting for the employer to review it.'
  },
  Under_Review: {
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    label: 'Under Review',
    emoji: '🔍',
    desc: 'The employer is currently reviewing your application.'
  },
  Shortlisted: {
    badge: 'bg-purple-50 text-purple-700 border-purple-200',
    label: 'Shortlisted ⭐',
    emoji: '⭐',
    desc: "Congratulations! You've been shortlisted. The employer may contact you for an interview."
  },
  Interview_Scheduled: {
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    label: 'Interview Scheduled',
    emoji: '📅',
    desc: 'An interview has been scheduled. Check your email for details.'
  },
  Offered: {
    badge: 'bg-green-50 text-green-700 border-green-200',
    label: 'Offer Received 🎊',
    emoji: '🎁',
    desc: 'You have received an internship offer! Please accept or decline below.'
  },
  Accepted: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    label: 'Accepted 🏆',
    emoji: '🏆',
    desc: "You've accepted this internship offer. Congratulations!"
  },
  Rejected: {
    badge: 'bg-red-50 text-red-700 border-red-200',
    label: 'Not Selected',
    emoji: '❌',
    desc: "The employer has decided not to move forward with your application. Keep applying!"
  },
  Withdrawn: {
    badge: 'bg-gray-50 text-gray-500 border-gray-200',
    label: 'Withdrawn',
    emoji: '↩️',
    desc: 'You have withdrawn this application.'
  },
}

export default function MyApplications() {
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const fetchApps = () => {
    api.get('/students/me/applications')
      .then(r => setApps(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(fetchApps, [])

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 5000)
  }

  // Helpers to handle both flat and nested shapes
  const getTitle = (app: Application) => app.listing_title ?? app.title ?? 'Internship Position'
  const getCompany = (app: Application) => app.company_name ?? ''
  const getLocation = (app: Application) => app.location ?? ''

  const withdraw = async (id: string) => {
    if (!confirm('Are you sure you want to withdraw this application?')) return
    try {
      await api.delete(`/applications/${id}`)
      showMsg('Application withdrawn successfully.', 'success')
      fetchApps()
    } catch (e: any) {
      showMsg(e.response?.data?.error?.message || 'Cannot withdraw at this stage.', 'error')
    }
  }

  const accept = async (id: string) => {
    if (!confirm('Accept this internship offer? This action cannot be undone.')) return
    try {
      await api.post(`/applications/${id}/accept`)
      showMsg('🎉 Congratulations! Offer accepted! You will receive a confirmation email.', 'success')
      fetchApps()
    } catch (e: any) {
      showMsg(e.response?.data?.error?.message || 'Failed', 'error')
    }
  }

  const rejectOffer = async (id: string) => {
    if (!confirm('Are you sure you want to decline this offer?')) return
    try {
      await api.post(`/applications/${id}/reject-offer`)
      showMsg('Offer declined.', 'success')
      fetchApps()
    } catch (e: any) {
      showMsg(e.response?.data?.error?.message || 'Failed', 'error')
    }
  }

  const statusCounts = apps.reduce((acc, app) => {
    acc[app.status] = (acc[app.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="gradient-bg text-white px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <p className="text-white/70 text-sm mb-1 tracking-wide uppercase">Student Portal</p>
          <h1 className="text-4xl font-bold">My Applications</h1>
          <p className="text-white/70 mt-2">Track the status of all your internship applications</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Summary chips */}
        {apps.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-6">
            <div className="bg-white border border-gray-100 rounded-2xl px-4 py-2 text-sm font-semibold text-gray-600 shadow-sm">
              📋 Total: <span className="text-purple-700 font-bold">{apps.length}</span>
            </div>
            {statusCounts['Submitted'] && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2 text-sm font-semibold text-amber-700">
                ⏳ Awaiting: {statusCounts['Submitted']}
              </div>
            )}
            {statusCounts['Shortlisted'] && (
              <div className="bg-purple-50 border border-purple-200 rounded-2xl px-4 py-2 text-sm font-semibold text-purple-700">
                ⭐ Shortlisted: {statusCounts['Shortlisted']}
              </div>
            )}
            {statusCounts['Offered'] && (
              <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-2 text-sm font-semibold text-green-700">
                🎁 Offers: {statusCounts['Offered']}
              </div>
            )}
            {statusCounts['Rejected'] && (
              <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-2 text-sm font-semibold text-red-700">
                ❌ Not Selected: {statusCounts['Rejected']}
              </div>
            )}
          </div>
        )}

        {/* Notification */}
        {msg && (
          <div className={`mb-6 p-4 rounded-2xl border text-sm font-semibold ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : apps.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-5xl mb-4">📂</p>
            <p className="text-lg font-semibold">No applications yet</p>
            <p className="text-sm mt-1">Browse internships and start applying!</p>
          </div>
        ) : (
          <div className="space-y-5">
            {apps.map(app => {
              const status = statusConfig[app.status] || statusConfig['Submitted']
              const title = getTitle(app)
              const company = getCompany(app)
              const location = getLocation(app)

              return (
                <div key={app.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden card-hover">
                  {/* Main row */}
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 gradient-bg rounded-2xl flex items-center justify-center text-white font-bold text-xl flex-shrink-0 shadow-md">
                          {(company?.[0] || title?.[0] || 'I').toUpperCase()}
                        </div>
                        <div>
                          <h3 className="font-bold text-gray-900 text-lg">{title}</h3>
                          {company && <p className="text-purple-600 font-bold text-sm">{company}</p>}
                          <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500">
                            {location && <span>📍 {location}</span>}
                            <span>📅 Applied {new Date(app.submitted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                          </div>
                        </div>
                      </div>

                      {/* Status badge */}
                      <span className={`flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full border flex-shrink-0 ${status.badge}`}>
                        {status.emoji} {status.label}
                      </span>
                    </div>

                    {/* Status description */}
                    <div className={`mt-4 p-3 rounded-xl text-xs font-medium ${status.badge.replace('border-', 'border ')} border`}>
                      {status.desc}
                    </div>

                    {/* Action buttons */}
                    <div className="mt-4 flex gap-2 flex-wrap">
                      {['Submitted', 'Under_Review'].includes(app.status) && (
                        <button onClick={() => withdraw(app.id)}
                          className="text-sm bg-white text-red-600 border border-red-200 hover:bg-red-50 px-4 py-2 rounded-xl font-bold transition-all">
                          ↩ Withdraw
                        </button>
                      )}
                      {app.status === 'Offered' && (
                        <>
                          <button onClick={() => accept(app.id)}
                            className="text-sm gradient-bg text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm hover:opacity-90">
                            ✅ Accept Offer
                          </button>
                          <button onClick={() => rejectOffer(app.id)}
                            className="text-sm bg-white text-red-600 border border-red-200 hover:bg-red-50 px-4 py-2.5 rounded-xl font-bold transition-all">
                            Decline Offer
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

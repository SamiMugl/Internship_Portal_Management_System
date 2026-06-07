import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api/client'

interface Application {
  id: string
  status: string
  submitted_at: string
  // Backend returns these flat fields (snake_case)
  student_name?: string
  institution?: string | null
  gpa?: string | number | null
  skills?: string[] | null
  bio?: string | null
  resume_file_url?: string | null
  resume_original_name?: string | null
}

const statusConfig: Record<string, { badge: string; label: string; emoji: string }> = {
  Submitted:           { badge: 'bg-blue-50 text-blue-700 border-blue-200',    label: 'Submitted',           emoji: '📤' },
  Under_Review:        { badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Under Review',        emoji: '🔍' },
  Shortlisted:         { badge: 'bg-purple-50 text-purple-700 border-purple-200', label: 'Shortlisted',      emoji: '⭐' },
  Interview_Scheduled: { badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', label: 'Interview Scheduled', emoji: '📅' },
  Offered:             { badge: 'bg-green-50 text-green-700 border-green-200',  label: 'Offered',             emoji: '🎁' },
  Accepted:            { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Accepted',       emoji: '🏆' },
  Rejected:            { badge: 'bg-red-50 text-red-700 border-red-200',        label: 'Rejected',            emoji: '❌' },
  Withdrawn:           { badge: 'bg-gray-50 text-gray-600 border-gray-200',     label: 'Withdrawn',           emoji: '↩️' },
}

export default function EmployerApplications() {
  const { listingId } = useParams()
  const navigate = useNavigate()
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [scheduling, setScheduling] = useState<string | null>(null)
  const [interview, setInterview] = useState({ scheduledAt: '', mode: 'online', locationOrLink: '' })
  const [filter, setFilter] = useState('all')

  const fetchApps = () => {
    api.get(`/listings/${listingId}/applications`)
      .then(r => setApps(r.data.data || r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(fetchApps, [listingId])

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/applications/${id}/status`, { status })
      showMsg(`✅ Application ${status.replace('_', ' ')} — student has been notified.`, 'success')
      fetchApps()
    } catch (e: any) {
      showMsg(e.response?.data?.error?.message || 'Failed to update status', 'error')
    }
  }

  const scheduleInterview = async (appId: string) => {
    if (!interview.scheduledAt || !interview.locationOrLink) {
      showMsg('Please fill in all interview details.', 'error')
      return
    }
    try {
      // Convert datetime-local value to full ISO-8601 string
      const isoDateTime = new Date(interview.scheduledAt).toISOString()
      await api.post(`/applications/${appId}/interview`, {
        scheduledAt: isoDateTime,
        mode: interview.mode,
        locationOrLink: interview.locationOrLink,
      })
      setScheduling(null)
      setInterview({ scheduledAt: '', mode: 'online', locationOrLink: '' })
      showMsg('✅ Interview scheduled! Student has been notified via email.', 'success')
      fetchApps()
    } catch (e: any) {
      showMsg(e.response?.data?.error?.message || 'Failed', 'error')
    }
  }

  const extendOffer = async (id: string) => {
    const startDate = prompt('Internship start date (YYYY-MM-DD):')
    const durationWeeks = prompt('Duration in weeks:')
    const stipend = prompt('Monthly stipend (leave blank if unpaid):')
    if (!startDate || !durationWeeks) return
    try {
      await api.post(`/applications/${id}/offer`, {
        startDate,
        durationWeeks: Number(durationWeeks),
        stipend: stipend ? Number(stipend) : null
      })
      showMsg('✅ Offer extended! Student has been notified.', 'success')
      fetchApps()
    } catch (e: any) {
      showMsg(e.response?.data?.error?.message || 'Failed', 'error')
    }
  }

  // Helper: get field from flat snake_case response
  const getName = (app: Application) => app.student_name ?? 'Student'
  const getCvUrl = (app: Application) => {
    const url = app.resume_file_url ?? ''
    if (!url) return ''
    if (url.startsWith('http')) return url
    return `http://localhost:3001${url}`
  }
  const getCvName = (app: Application) => app.resume_original_name ?? 'Resume.pdf'

  const filtered = filter === 'all' ? apps : apps.filter(a => a.status === filter)

  const counts = {
    all: apps.length,
    Submitted: apps.filter(a => a.status === 'Submitted').length,
    Under_Review: apps.filter(a => a.status === 'Under_Review').length,
    Shortlisted: apps.filter(a => a.status === 'Shortlisted').length,
    Rejected: apps.filter(a => a.status === 'Rejected').length,
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="gradient-bg text-white px-6 py-12">
        <div className="max-w-5xl mx-auto">
          <button onClick={() => navigate('/employer/listings')}
            className="text-white/70 hover:text-white text-sm mb-3 flex items-center gap-1 transition-colors">
            ← Back to Listings
          </button>
          <p className="text-white/70 text-sm mb-1 uppercase tracking-wide">Employer Portal</p>
          <h1 className="text-4xl font-bold">Applications</h1>
          <p className="text-white/70 mt-1">{apps.length} total applicant{apps.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {msg && (
          <div className={`mb-5 p-4 rounded-xl border text-sm font-semibold ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'Submitted', label: '📤 Submitted', count: counts.Submitted },
            { key: 'Under_Review', label: '🔍 Under Review', count: counts.Under_Review },
            { key: 'Shortlisted', label: '⭐ Shortlisted', count: counts.Shortlisted },
            { key: 'Rejected', label: '❌ Rejected', count: counts.Rejected },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${filter === f.key ? 'gradient-bg text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
              {f.label} <span className="ml-1.5 bg-black/10 px-2 py-0.5 rounded-full text-xs">{f.count}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-5xl mb-4">📭</p>
            <p className="text-lg font-semibold">No applications here</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map(app => {
              const status = statusConfig[app.status] || statusConfig.Submitted
              const name = getName(app)
              const cvUrl = getCvUrl(app)
              const cvName = getCvName(app)
              const isExpanded = expanded === app.id

              return (
                <div key={app.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {/* Header row */}
                  <div className="p-5 flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 gradient-bg rounded-xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                        {name[0].toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-lg">{name}</h3>
                        <div className="flex flex-wrap gap-3 mt-1 text-sm text-gray-500">
                          {app.institution && <span>🏫 {app.institution}</span>}
                          {app.gpa && <span>📊 GPA: {app.gpa}</span>}
                          <span>📅 Applied {new Date(app.submitted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold px-3 py-1.5 rounded-full border ${status.badge}`}>
                        {status.emoji} {status.label}
                      </span>
                      <button onClick={() => setExpanded(isExpanded ? null : app.id)}
                        className="text-sm text-purple-600 font-bold hover:text-purple-800 px-3 py-1.5 border border-purple-200 rounded-xl hover:bg-purple-50 transition-all">
                        {isExpanded ? '▲ Hide' : '▼ View Profile'}
                      </button>
                    </div>
                  </div>

                  {/* Expanded profile */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 p-5 bg-gray-50 space-y-4">
                      {/* Skills */}
                      {app.skills && app.skills.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-gray-500 uppercase mb-2">Skills</p>
                          <div className="flex flex-wrap gap-2">
                            {app.skills.map(s => (
                              <span key={s} className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2.5 py-1 rounded-full font-medium">{s}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Bio */}
                      {app.bio && (
                        <div>
                          <p className="text-xs font-bold text-gray-500 uppercase mb-1">About</p>
                          <p className="text-sm text-gray-700">{app.bio}</p>
                        </div>
                      )}

                      {/* CV Download */}
                      <div>
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Resume / CV</p>
                        {cvUrl ? (
                          <a href={cvUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 gradient-bg text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:opacity-90 transition-all shadow-md">
                            📄 Download CV — {cvName}
                          </a>
                        ) : (
                          <p className="text-sm text-gray-400 italic">No CV uploaded</p>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div>
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Actions</p>
                        <div className="flex flex-wrap gap-2">
                          {app.status === 'Submitted' && (
                            <>
                              <button onClick={() => updateStatus(app.id, 'Under_Review')}
                                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all">
                                🔍 Mark Under Review
                              </button>
                              <button onClick={() => updateStatus(app.id, 'Rejected')}
                                className="bg-white text-red-600 border border-red-200 hover:bg-red-50 px-4 py-2 rounded-xl text-sm font-bold transition-all">
                                ❌ Reject
                              </button>
                            </>
                          )}
                          {app.status === 'Under_Review' && (
                            <>
                              <button onClick={() => updateStatus(app.id, 'Shortlisted')}
                                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all">
                                ⭐ Shortlist
                              </button>
                              <button onClick={() => updateStatus(app.id, 'Rejected')}
                                className="bg-white text-red-600 border border-red-200 hover:bg-red-50 px-4 py-2 rounded-xl text-sm font-bold transition-all">
                                ❌ Reject
                              </button>
                            </>
                          )}
                          {app.status === 'Shortlisted' && (
                            <>
                              <button onClick={() => setScheduling(app.id)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all">
                                📅 Schedule Interview
                              </button>
                              <button onClick={() => updateStatus(app.id, 'Rejected')}
                                className="bg-white text-red-600 border border-red-200 hover:bg-red-50 px-4 py-2 rounded-xl text-sm font-bold transition-all">
                                ❌ Reject
                              </button>
                            </>
                          )}
                          {app.status === 'Interview_Scheduled' && (
                            <>
                              <button onClick={() => extendOffer(app.id)}
                                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all">
                                🎁 Extend Offer
                              </button>
                              <button onClick={() => updateStatus(app.id, 'Rejected')}
                                className="bg-white text-red-600 border border-red-200 hover:bg-red-50 px-4 py-2 rounded-xl text-sm font-bold transition-all">
                                ❌ Reject
                              </button>
                            </>
                          )}
                          {['Accepted', 'Rejected', 'Withdrawn'].includes(app.status) && (
                            <p className="text-sm text-gray-400 italic">No further actions available.</p>
                          )}
                        </div>
                      </div>

                      {/* Interview scheduler */}
                      {scheduling === app.id && (
                        <div className="bg-white border border-indigo-200 rounded-2xl p-5 space-y-3">
                          <h4 className="font-bold text-gray-800">📅 Schedule Interview</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-bold text-gray-600 mb-1">Date & Time</label>
                              <input type="datetime-local" value={interview.scheduledAt}
                                onChange={e => setInterview({ ...interview, scheduledAt: e.target.value })}
                                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-purple-500 focus:outline-none" />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-gray-600 mb-1">Mode</label>
                              <select value={interview.mode}
                                onChange={e => setInterview({ ...interview, mode: e.target.value })}
                                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-purple-500 focus:outline-none">
                                <option value="online">🖥 Online</option>
                                <option value="in-person">🏢 In-Person</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">
                              {interview.mode === 'online' ? 'Meeting Link' : 'Office Address'}
                            </label>
                            <input type="text" placeholder={interview.mode === 'online' ? 'https://meet.google.com/...' : 'Office address'}
                              value={interview.locationOrLink}
                              onChange={e => setInterview({ ...interview, locationOrLink: e.target.value })}
                              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-purple-500 focus:outline-none" />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => scheduleInterview(app.id)}
                              className="gradient-bg text-white px-5 py-2 rounded-xl text-sm font-bold hover:opacity-90">
                              ✅ Confirm Interview
                            </button>
                            <button onClick={() => setScheduling(null)}
                              className="bg-gray-100 text-gray-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-200">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

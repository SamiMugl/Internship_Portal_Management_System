import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'

interface Listing {
  id: string; title: string; status: string; location: string
  application_deadline: string; openings: number; accepted_count: number
  description?: string
}

const statusConfig: Record<string, { color: string; label: string; emoji: string }> = {
  draft:    { color: 'bg-gray-100 text-gray-600 border-gray-200',    label: 'Draft',    emoji: '📝' },
  pending:  { color: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Pending',  emoji: '⏳' },
  published:{ color: 'bg-green-100 text-green-700 border-green-200', label: 'Published',emoji: '✅' },
  closed:   { color: 'bg-red-100 text-red-600 border-red-200',       label: 'Closed',   emoji: '🔒' },
  rejected: { color: 'bg-red-100 text-red-700 border-red-200',       label: 'Rejected', emoji: '❌' },
}

export default function EmployerListings() {
  const navigate = useNavigate()
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', location: '', duration_weeks: '', openings: '', application_deadline: '', stipend_monthly: '' })
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const fetchListings = () => {
    api.get('/employers/me/listings').then(r => setListings(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(fetchListings, [])

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const createListing = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/listings', {
        title: form.title.trim(),
        description: form.description.trim(),
        location: form.location.trim(),
        durationWeeks: Number(form.duration_weeks),
        openings: Number(form.openings),
        applicationDeadline: form.application_deadline,
        stipendMonthly: form.stipend_monthly ? Number(form.stipend_monthly) : null,
        requiredSkills: []
      })
      showMsg('✅ Listing created as draft! Submit it for admin review when ready.', 'success')
      setShowForm(false)
      setForm({ title: '', description: '', location: '', duration_weeks: '', openings: '', application_deadline: '', stipend_monthly: '' })
      fetchListings()
    } catch (e: any) {
      showMsg(e.response?.data?.error?.message || 'Failed to create listing', 'error')
    }
  }

  const submit = async (id: string) => {
    try { await api.post(`/listings/${id}/submit`); showMsg('Submitted for admin review!', 'success'); fetchListings() }
    catch (e: any) { showMsg(e.response?.data?.error?.message || 'Failed', 'error') }
  }

  const deactivate = async (id: string) => {
    if (!confirm('Deactivate this listing? It will be hidden from students.')) return
    try { await api.post(`/listings/${id}/deactivate`); showMsg('Listing deactivated.', 'success'); fetchListings() }
    catch (e: any) { showMsg(e.response?.data?.error?.message || 'Failed', 'error') }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="gradient-bg text-white px-6 py-12">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div>
            <p className="text-white/70 text-sm mb-1 uppercase tracking-wide">Employer Portal</p>
            <h1 className="text-4xl font-bold">My Listings</h1>
            <p className="text-white/70 mt-1">Manage your internship postings</p>
          </div>
          <button onClick={() => setShowForm(!showForm)}
            className="bg-white text-purple-700 hover:bg-yellow-300 px-5 py-3 rounded-2xl font-bold transition-all shadow-lg text-sm">
            {showForm ? '✕ Cancel' : '+ New Listing'}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {msg && (
          <div className={`mb-5 p-4 rounded-xl border text-sm font-semibold ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}

        {/* Create form */}
        {showForm && (
          <form onSubmit={createListing} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-7 mb-7 space-y-4">
            <h2 className="font-bold text-gray-800 text-xl">Create New Listing</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Job Title', key: 'title', placeholder: 'e.g. Frontend Developer Intern' },
                { label: 'Location', key: 'location', placeholder: 'e.g. Lahore, Pakistan' },
                { label: 'Duration (weeks)', key: 'duration_weeks', type: 'number', placeholder: '8' },
                { label: 'Number of Openings', key: 'openings', type: 'number', placeholder: '3' },
                { label: 'Application Deadline', key: 'application_deadline', type: 'date', placeholder: '' },
                { label: 'Stipend/month (PKR)', key: 'stipend_monthly', type: 'number', placeholder: 'Leave blank if unpaid' },
              ].map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-sm font-bold text-gray-700 mb-1">{label}</label>
                  <input type={type || 'text'} placeholder={placeholder} value={(form as any)[key]}
                    onChange={e => setForm({ ...form, [key]: e.target.value })}
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500 text-sm" />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Job Description</label>
              <textarea rows={4} required placeholder="Describe the role, responsibilities, and requirements..."
                value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-purple-500 text-sm" />
            </div>
            <button type="submit" className="gradient-bg text-white px-8 py-3 rounded-2xl font-bold hover:opacity-90 transition-all">
              Create Listing
            </button>
          </form>
        )}

        {/* Listings */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-5xl mb-4">📋</p>
            <p className="text-lg font-semibold">No listings yet</p>
            <p className="text-sm mt-1">Create your first internship listing above</p>
          </div>
        ) : (
          <div className="space-y-5">
            {listings.map(l => {
              const s = statusConfig[l.status] || statusConfig.draft
              return (
                <div key={l.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 card-hover">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="font-bold text-gray-900 text-xl">{l.title}</h3>
                        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${s.color}`}>
                          {s.emoji} {s.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                        <span>📍 {l.location}</span>
                        <span>🗓 Deadline: {new Date(l.application_deadline).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                        <span>🪑 {l.accepted_count}/{l.openings} openings filled</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {l.status === 'draft' && (
                      <button onClick={() => submit(l.id)}
                        className="gradient-bg text-white px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition-all">
                        📤 Submit for Review
                      </button>
                    )}
                    {l.status === 'published' && (
                      <>
                        <button onClick={() => navigate(`/employer/listings/${l.id}/applications`)}
                          className="gradient-bg text-white px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition-all">
                          👥 View Applications
                        </button>
                        <button onClick={() => deactivate(l.id)}
                          className="bg-white text-red-600 border border-red-200 hover:bg-red-50 px-4 py-2 rounded-xl text-sm font-bold transition-all">
                          🔒 Deactivate
                        </button>
                      </>
                    )}
                    {l.status === 'closed' && (
                      <button onClick={() => navigate(`/employer/listings/${l.id}/applications`)}
                        className="bg-gray-100 text-gray-700 border border-gray-200 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-200 transition-all">
                        👥 View Applications
                      </button>
                    )}
                    {l.status === 'rejected' && (
                      <p className="text-sm text-red-600 font-medium">
                        ❌ Rejected by admin. Edit and resubmit.
                      </p>
                    )}
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

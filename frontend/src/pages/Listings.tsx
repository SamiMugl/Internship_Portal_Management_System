import { useEffect, useState } from 'react'
import api from '../api/client'

interface Listing {
  id: string
  title: string
  location: string
  stipend_monthly: number | null
  duration_weeks: number
  application_deadline: string
  openings: number
  accepted_count: number
  required_skills?: string[]
  employer?: { company_name: string }
}

export default function Listings() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [applying, setApplying] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    api.get('/listings')
      .then(r => setListings(r.data.data || r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const apply = async (id: string) => {
    setApplying(id)
    try {
      await api.post(`/listings/${id}/apply`, {})
      setMsg({ text: '🎉 Application submitted successfully! Good luck!', type: 'success' })
    } catch (e: any) {
      const code = e.response?.data?.error?.code
      const messages: Record<string, string> = {
        DUPLICATE_APPLICATION: 'You have already applied to this listing.',
        LISTING_CLOSED: 'This listing is no longer accepting applications.',
        DEADLINE_PASSED: 'The application deadline has passed.',
        PROFILE_INCOMPLETE: 'Please complete your profile to at least 60% before applying.',
      }
      setMsg({ text: messages[code] || e.response?.data?.error?.message || 'Failed to apply', type: 'error' })
    } finally {
      setApplying(null)
      setTimeout(() => setMsg(null), 4000)
    }
  }

  const daysLeft = (deadline: string) => {
    return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000)
  }

  const filtered = listings.filter(l =>
    l.title.toLowerCase().includes(search.toLowerCase()) ||
    l.location?.toLowerCase().includes(search.toLowerCase()) ||
    l.employer?.company_name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="gradient-bg text-white px-6 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-3">Discover Your Dream Internship</h1>
          <p className="text-white/80 text-lg mb-8">Browse opportunities from top companies worldwide</p>
          <div className="relative max-w-2xl mx-auto">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">🔍</span>
            <input placeholder="Search by title, company, or location..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white text-gray-800 shadow-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 text-base" />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <p className="text-gray-600 font-medium">
            <span className="text-purple-700 font-bold text-xl">{filtered.length}</span> internships found
          </p>
          <p className="text-sm text-gray-400">Sorted by: Most Recent</p>
        </div>

        {msg && (
          <div className={`mb-6 p-4 rounded-2xl border text-sm font-semibold animate-slide-up ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {msg.text}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-5xl mb-4">💼</p>
            <p className="text-lg font-semibold">No internships found</p>
            <p className="text-sm mt-1">Try adjusting your search</p>
          </div>
        ) : (
          <div className="space-y-5">
            {filtered.map(l => {
              const days = daysLeft(l.application_deadline)
              const remaining = l.openings - l.accepted_count
              return (
                <div key={l.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 card-hover">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="w-14 h-14 gradient-bg rounded-2xl flex items-center justify-center text-white font-bold text-xl flex-shrink-0 shadow-md">
                        {(l.employer?.company_name?.[0] || l.title[0]).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-bold text-gray-900">{l.title}</h2>
                        <p className="text-purple-600 font-bold text-sm mt-0.5">{l.employer?.company_name || 'Company'}</p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <span className="flex items-center gap-1 text-sm text-gray-600 bg-gray-50 border border-gray-100 px-3 py-1 rounded-xl">
                            📍 {l.location}
                          </span>
                          <span className="flex items-center gap-1 text-sm text-gray-600 bg-gray-50 border border-gray-100 px-3 py-1 rounded-xl">
                            ⏱ {l.duration_weeks} weeks
                          </span>
                          <span className="flex items-center gap-1 text-sm text-gray-600 bg-gray-50 border border-gray-100 px-3 py-1 rounded-xl">
                            💰 {l.stipend_monthly ? `$${Number(l.stipend_monthly).toLocaleString()}/mo` : 'Unpaid'}
                          </span>
                          <span className="flex items-center gap-1 text-sm text-gray-600 bg-gray-50 border border-gray-100 px-3 py-1 rounded-xl">
                            👥 {remaining} openings left
                          </span>
                          <span className={`flex items-center gap-1 text-sm font-semibold px-3 py-1 rounded-xl ${days <= 3 ? 'bg-red-50 text-red-600' : days <= 7 ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                            🗓 {days > 0 ? `${days} days left` : 'Deadline passed'}
                          </span>
                        </div>
                        {l.required_skills && l.required_skills.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-3">
                            {l.required_skills.slice(0, 5).map(skill => (
                              <span key={skill} className="text-xs bg-purple-50 text-purple-700 border border-purple-100 px-2.5 py-1 rounded-full font-medium">
                                {skill}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 pt-1">
                      <button onClick={() => apply(l.id)} disabled={applying === l.id || days <= 0}
                        className="gradient-bg text-white px-6 py-3 rounded-xl text-sm font-bold hover:opacity-90 transition-all disabled:opacity-40 shadow-md shadow-purple-100 whitespace-nowrap">
                        {applying === l.id ? '⏳ Applying...' : '🚀 Apply Now'}
                      </button>
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

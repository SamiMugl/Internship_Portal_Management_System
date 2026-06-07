import { useEffect, useState } from 'react'
import api from '../api/client'

interface Listing { id: string; title: string; location: string; status: string; employer?: { company_name: string } }

export default function AdminListings() {
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const fetchListings = () => {
    api.get('/admin/listings/pending').then(r => setListings(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(fetchListings, [])

  const approve = async (id: string) => {
    try { await api.post(`/admin/listings/${id}/approve`); setMsg('Listing approved!'); fetchListings() }
    catch (e: any) { setMsg(e.response?.data?.error?.message || 'Failed') }
  }

  const reject = async (id: string) => {
    const reason = prompt('Rejection reason:')
    if (!reason) return
    try { await api.post(`/admin/listings/${id}/reject`, { reason }); setMsg('Listing rejected.'); fetchListings() }
    catch (e: any) { setMsg(e.response?.data?.error?.message || 'Failed') }
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Pending Listings</h1>
      {msg && <div className="mb-4 p-3 rounded bg-blue-50 border border-blue-200 text-blue-700 text-sm">{msg}</div>}
      {loading ? <div className="text-center text-gray-500">Loading...</div> : (
        <div className="space-y-3">
          {listings.length === 0 && <p className="text-gray-500">No pending listings.</p>}
          {listings.map(l => (
            <div key={l.id} className="bg-white rounded-xl shadow border border-gray-100 p-5 flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-gray-800">{l.title}</h3>
                <p className="text-sm text-gray-500">📍 {l.location} &nbsp;|&nbsp; 🏢 {l.employer?.company_name}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => approve(l.id)} className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">Approve</button>
                <button onClick={() => reject(l.id)} className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1 rounded hover:bg-red-100">Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import api from '../api/client'

export default function EmployerProfile() {
  const [form, setForm] = useState({ company_name: '', industry: '', description: '', website_url: '', contact_person: '', size_range: '' })
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/employers/me/profile').then(r => setForm(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      // Map snake_case form fields to camelCase for the backend
      await api.put('/employers/me/profile', {
        companyName: form.company_name,
        industry: form.industry,
        description: form.description,
        websiteUrl: form.website_url || null,
        contactPerson: form.contact_person,
        sizeRange: form.size_range,
      })
      setMsg('Profile saved successfully!')
    }
    catch (e: any) { setMsg(e.response?.data?.error?.message || 'Failed to save profile') }
  }

  if (loading) return <div className="text-center p-10 text-gray-500">Loading...</div>

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Company Profile</h1>
      {msg && <div className="mb-4 p-3 rounded bg-blue-50 border border-blue-200 text-blue-700 text-sm">{msg}</div>}
      <form onSubmit={save} className="bg-white rounded-xl shadow border border-gray-100 p-6 space-y-4">
        {[
          { label: 'Company Name', key: 'company_name' },
          { label: 'Industry', key: 'industry' },
          { label: 'Website URL', key: 'website_url' },
          { label: 'Contact Person', key: 'contact_person' },
          { label: 'Company Size', key: 'size_range' },
        ].map(({ label, key }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <input type="text" value={(form as any)[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        ))}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea rows={4} value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="submit" className="w-full bg-blue-700 text-white py-2 rounded-lg font-semibold hover:bg-blue-800">Save Profile</button>
      </form>
    </div>
  )
}

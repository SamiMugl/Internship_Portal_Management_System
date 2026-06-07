import { useEffect, useState, useRef } from 'react'
import api from '../api/client'

interface Profile {
  full_name: string; institution: string; degree: string
  gpa: number | null; graduation_year: number | null
  skills: string[] | null; bio: string; completion_pct: number | null
}

interface Resume {
  id: string; original_name: string; file_url: string
  uploaded_at: string; is_active: boolean
}

export default function StudentProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState<Partial<Profile>>({})
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeResume, setActiveResume] = useState<Resume | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchProfile = () => {
    api.get('/students/me/profile').then(r => {
      setProfile(r.data)
      setForm(r.data || {})
    }).catch(() => {}).finally(() => setLoading(false))
  }

  const fetchResume = () => {
    // Try to get active resume info — backend may return it embedded or via separate call
    api.get('/students/me/profile').then(r => {
      // profile endpoint doesn't return resume; we'll handle it via upload response
    }).catch(() => {})
  }

  useEffect(() => { fetchProfile() }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const cleanedForm = { ...form }
      if (cleanedForm.gpa === 0 || isNaN(cleanedForm.gpa as number)) cleanedForm.gpa = null
      if (cleanedForm.graduation_year === 0 || isNaN(cleanedForm.graduation_year as number)) cleanedForm.graduation_year = null

      await api.put('/students/me/profile', {
        fullName: cleanedForm.full_name,
        institution: cleanedForm.institution,
        degree: cleanedForm.degree,
        gpa: cleanedForm.gpa,
        graduationYear: cleanedForm.graduation_year,
        skills: cleanedForm.skills,
        bio: cleanedForm.bio,
      })

      const r = await api.get('/students/me/profile')
      setProfile(r.data)
      setMsg('Profile saved successfully!')
      setTimeout(() => setMsg(''), 3000)
    } catch (e: any) {
      setMsg(e.response?.data?.error?.message || 'Save failed')
    }
  }

  const uploadResume = async (file: File) => {
    if (!file) return
    setUploading(true)
    setUploadMsg('')
    try {
      const formData = new FormData()
      formData.append('resume', file)
      const r = await api.post('/students/me/resume', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setActiveResume(r.data.resume)
      setUploadMsg('✅ CV uploaded successfully! You can now apply to listings.')
      // Refresh profile to update completion %
      const profileR = await api.get('/students/me/profile')
      setProfile(profileR.data)
      setForm(profileR.data || {})
    } catch (e: any) {
      const errMsg = e.response?.data?.error?.message || 'Upload failed'
      setUploadMsg('❌ ' + errMsg)
    } finally {
      setUploading(false)
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadResume(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadResume(file)
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="gradient-bg text-white px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <p className="text-white/70 text-sm mb-1 tracking-wide uppercase">Student Portal</p>
          <h1 className="text-4xl font-bold">My Profile</h1>
          <p className="text-white/70 mt-2">Keep your profile updated to improve your chances</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Completion bar */}
        {profile?.completion_pct != null && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex justify-between text-sm font-semibold text-gray-700 mb-2">
              <span>Profile Completion</span>
              <span className={profile.completion_pct >= 60 ? 'text-green-600' : 'text-amber-600'}>
                {profile.completion_pct}%
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div className={`h-3 rounded-full transition-all duration-500 ${profile.completion_pct >= 60 ? 'bg-green-500' : 'bg-amber-400'}`}
                style={{ width: `${profile.completion_pct}%` }}></div>
            </div>
            {profile.completion_pct < 60 ? (
              <p className="text-xs text-amber-600 mt-2 font-medium">
                ⚠️ You need at least 60% to apply. Fill in your details and upload a CV.
              </p>
            ) : (
              <p className="text-xs text-green-600 mt-2 font-medium">
                ✅ Great! You can apply to internship listings.
              </p>
            )}
          </div>
        )}

        {/* CV Upload Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-1">📄 Resume / CV</h2>
          <p className="text-sm text-gray-500 mb-4">Upload your CV to apply to internships. Accepted formats: PDF, DOCX (max 5MB)</p>

          {uploadMsg && (
            <div className={`mb-4 p-3 rounded-xl text-sm font-medium ${uploadMsg.startsWith('✅') ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {uploadMsg}
            </div>
          )}

          {activeResume && (
            <div className="mb-4 flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
              <span className="text-2xl">📋</span>
              <div>
                <p className="text-sm font-semibold text-green-800">{activeResume.original_name}</p>
                <p className="text-xs text-green-600">Uploaded {new Date(activeResume.uploaded_at).toLocaleDateString()}</p>
              </div>
              <span className="ml-auto text-xs bg-green-600 text-white px-2 py-1 rounded-full font-bold">Active</span>
            </div>
          )}

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${dragOver ? 'border-purple-500 bg-purple-50' : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50/50'}`}>
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-3 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm text-purple-600 font-medium">Uploading...</p>
              </div>
            ) : (
              <>
                <div className="text-4xl mb-3">📤</div>
                <p className="text-gray-700 font-semibold">Click to upload or drag & drop</p>
                <p className="text-sm text-gray-400 mt-1">PDF or DOCX • Max 5MB</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileInput} className="hidden" />
        </div>

        {/* Profile form */}
        {msg && <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium">{msg}</div>}

        <form onSubmit={save} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h2 className="text-lg font-bold text-gray-800 mb-2">👤 Personal & Academic Info</h2>

          {[
            { label: 'Full Name', key: 'full_name' },
            { label: 'Institution / University', key: 'institution' },
            { label: 'Degree', key: 'degree' },
            { label: 'GPA (0.00 – 4.00)', key: 'gpa', type: 'number' },
            { label: 'Graduation Year', key: 'graduation_year', type: 'number' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-sm font-bold text-gray-700 mb-1">{label}</label>
              <input type={type || 'text'} value={(form as any)[key] ?? ''}
                step={type === 'number' ? '0.01' : undefined}
                onChange={e => {
                  const val = e.target.value
                  setForm({ ...form, [key]: type === 'number' ? (val === '' ? null : Number(val)) : val })
                }}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500 transition-all text-sm" />
            </div>
          ))}

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Skills (comma separated)</label>
            <input type="text" placeholder="e.g. JavaScript, React, Python"
              value={Array.isArray(form.skills) ? form.skills.join(', ') : ''}
              onChange={e => {
                const val = e.target.value
                setForm({ ...form, skills: val ? val.split(',').map(s => s.trim()).filter(Boolean) : [] })
              }}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500 transition-all text-sm" />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Bio</label>
            <textarea rows={3} placeholder="Tell employers about yourself..."
              value={form.bio || ''}
              onChange={e => setForm({ ...form, bio: e.target.value })}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500 transition-all text-sm" />
          </div>

          <button type="submit"
            className="w-full gradient-bg text-white py-3.5 rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg shadow-purple-200">
            Save Profile
          </button>
        </form>
      </div>
    </div>
  )
}

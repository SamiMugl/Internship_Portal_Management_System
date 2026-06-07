import { useEffect, useState } from 'react'
import api from '../api/client'

interface Notification { id: string; event_type: string; is_read: boolean; created_at: string; payload: any }

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const fetchNotifications = () => {
    api.get('/notifications').then(r => setNotifications(r.data.data || r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(fetchNotifications, [])

  const markRead = async (id: string) => {
    await api.put(`/notifications/${id}/read`)
    fetchNotifications()
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Notifications</h1>
      {loading ? <div className="text-center text-gray-500">Loading...</div> : (
        <div className="space-y-3">
          {notifications.length === 0 && <p className="text-gray-500">No notifications.</p>}
          {notifications.map(n => (
            <div key={n.id} onClick={() => !n.is_read && markRead(n.id)}
              className={`rounded-xl border p-4 cursor-pointer transition ${n.is_read ? 'bg-white border-gray-100' : 'bg-blue-50 border-blue-200'}`}>
              <div className="flex justify-between">
                <span className="font-medium text-gray-700 text-sm">{n.event_type.replace(/_/g, ' ')}</span>
                <span className="text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</span>
              </div>
              {!n.is_read && <span className="inline-block mt-1 text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Unread</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

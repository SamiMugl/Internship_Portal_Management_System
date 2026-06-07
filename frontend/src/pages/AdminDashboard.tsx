import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/client'

interface Stats {
  pendingEmployerAccounts: number
  pendingListings: number
  activeStudents: number
  totalApplications: number
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/admin/dashboard')
      .then(r => setStats(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const statCards = [
    {
      label: 'Pending Employers',
      value: stats?.pendingEmployerAccounts ?? 0,
      desc: 'Awaiting approval',
      link: '/admin/employers',
      gradient: 'from-amber-400 to-orange-500',
      emoji: '⏳'
    },
    {
      label: 'Pending Listings',
      value: stats?.pendingListings ?? 0,
      desc: 'Need review',
      link: '/admin/listings',
      gradient: 'from-blue-400 to-indigo-600',
      emoji: '📋'
    },
    {
      label: 'Active Students',
      value: stats?.activeStudents ?? 0,
      desc: 'Registered users',
      link: '/admin/students',
      gradient: 'from-green-400 to-emerald-600',
      emoji: '🎓'
    },
    {
      label: 'Total Applications',
      value: stats?.totalApplications ?? 0,
      desc: 'All time',
      link: '/admin/applications',
      gradient: 'from-purple-400 to-pink-600',
      emoji: '📊'
    },
  ]

  const quickActions = [
    {
      title: 'Manage Employers',
      desc: 'Approve or reject employer account registrations.',
      emoji: '🏢',
      link: '/admin/employers',
      gradient: 'from-amber-400 to-orange-500',
    },
    {
      title: 'Moderate Listings',
      desc: 'Review and publish internship listings.',
      emoji: '📋',
      link: '/admin/listings',
      gradient: 'from-blue-400 to-indigo-600',
    },
    {
      title: 'Audit Log',
      desc: 'View all administrative actions history.',
      emoji: '📜',
      link: '/admin/audit-log',
      gradient: 'from-purple-400 to-pink-600',
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="gradient-bg text-white px-6 py-12">
        <div className="max-w-7xl mx-auto">
          <p className="text-white/70 text-sm font-medium mb-1 tracking-wide uppercase">Administrator Panel</p>
          <h1 className="text-4xl font-bold">Dashboard Overview</h1>
          <p className="text-white/70 mt-2 text-lg">Welcome back! Here's what needs your attention today.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          {statCards.map(card => (
            <Link key={card.label} to={card.link}
              className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 card-hover flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center text-2xl shadow-lg`}>
                  {card.emoji}
                </div>
                <span className="text-xs font-semibold text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">{card.desc}</span>
              </div>
              <div>
                <p className="text-4xl font-bold text-gray-900">
                  {loading ? <span className="inline-block w-8 h-8 rounded bg-gray-200 animate-pulse"></span> : card.value}
                </p>
                <p className="text-gray-500 text-sm mt-1 font-medium">{card.label}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-xl font-bold text-gray-800 mb-5">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {quickActions.map(action => (
              <Link key={action.title} to={action.link}
                className="bg-white rounded-2xl p-7 shadow-sm border border-gray-100 card-hover group flex flex-col">
                <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${action.gradient} flex items-center justify-center text-3xl shadow-md mb-5 group-hover:scale-110 transition-transform duration-200`}>
                  {action.emoji}
                </div>
                <h3 className="font-bold text-gray-900 text-lg mb-2">{action.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed flex-1">{action.desc}</p>
                <div className="mt-5 text-sm font-bold text-purple-600 flex items-center gap-1 group-hover:gap-2 transition-all">
                  Open <span>→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Activity placeholder */}
        <div className="mt-10 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">Recent Activity</h2>
          <div className="space-y-3">
            {[
              { text: 'New employer registration pending approval', time: 'Just now', color: 'bg-amber-400' },
              { text: 'New internship listing submitted for review', time: '5 min ago', color: 'bg-blue-400' },
              { text: 'Student application submitted', time: '12 min ago', color: 'bg-green-400' },
              { text: 'Admin approved employer account', time: '1 hour ago', color: 'bg-purple-400' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 transition-colors">
                <div className={`w-2.5 h-2.5 rounded-full ${item.color} flex-shrink-0`}></div>
                <p className="text-gray-700 text-sm flex-1">{item.text}</p>
                <span className="text-xs text-gray-400 flex-shrink-0">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

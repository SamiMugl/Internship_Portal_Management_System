import React, { createContext, useContext, useState, useEffect } from 'react'

interface User {
  userId: string
  email: string
  role: 'student' | 'employer' | 'admin'
}

interface AuthContextType {
  user: User | null
  login: (accessToken: string, refreshToken: string) => void
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

function parseJwt(token: string): User | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return { userId: payload.sub, email: payload.email, role: payload.role }
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (token) setUser(parseJwt(token))
    setIsLoading(false)
  }, [])

  const login = (accessToken: string, refreshToken: string) => {
    localStorage.clear() // Clear any previous session data
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    setUser(parseJwt(accessToken))
  }

  const logout = () => {
    localStorage.clear()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}

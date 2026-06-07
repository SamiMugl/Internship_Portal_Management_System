import React from 'react'

interface State { hasError: boolean; error: string }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', fontFamily: 'monospace', background: '#fff3f3', minHeight: '100vh' }}>
          <h2 style={{ color: '#dc2626', fontSize: '20px', marginBottom: '12px' }}>⚠️ Page Error</h2>
          <pre style={{ color: '#7f1d1d', fontSize: '13px', whiteSpace: 'pre-wrap' }}>{this.state.error}</pre>
          <button onClick={() => this.setState({ hasError: false, error: '' })}
            style={{ marginTop: '16px', padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

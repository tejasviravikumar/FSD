const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '')

let accessToken = null
let refreshPromise = null

export class ApiError extends Error {
  constructor(message, status, details, correlationId) {
    super(message)
    this.status = status
    this.details = details
    this.correlationId = correlationId
  }
}

const authHeaders = () => {
  const headers = new Headers()
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return headers
}

// -----------------------------------------------------------------------------
// Core JSON request (retries once after refreshing an expired session)
// -----------------------------------------------------------------------------
async function request(path, options = {}, retried = false) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = new Headers(options.headers || {})

  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  if (method !== 'GET' && method !== 'HEAD') headers.set('X-Requested-With', 'XMLHttpRequest')
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    method,
    headers,
    credentials: 'include',
  })

  const raw = await response.text()
  let payload
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = { message: raw }
  }

  if (response.status === 401 && !retried && path !== '/auth/login' && path !== '/auth/refresh') {
    try {
      await refreshSession()
      return request(path, options, true)
    } catch {
      accessToken = null
      window.dispatchEvent(new Event('nexora:session-expired'))
      throw new ApiError('Your session expired. Please sign in again.', 401)
    }
  }

  if (!response.ok || payload.success === false) {
    throw new ApiError(
      payload.message || `Request failed (${response.status})`,
      response.status,
      payload.data,
      payload.correlationId,
    )
  }

  return payload
}

// -----------------------------------------------------------------------------
// Session refresh (shared in-flight promise so concurrent 401s refresh once)
// -----------------------------------------------------------------------------
export async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
      .then(async response => {
        const payload = await response.json().catch(() => ({}))

        if (!response.ok) {
          accessToken = null
          if (response.status === 401) window.dispatchEvent(new Event('nexora:session-expired'))
          throw new ApiError(payload.message || 'Session expired', response.status)
        }

        accessToken = payload.data?.accessToken || null
        return payload
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

// -----------------------------------------------------------------------------
// Public client
// -----------------------------------------------------------------------------
export const api = {
  get: path => request(path),

  post: (path, data, headers) =>
    request(path, {
      method: 'POST',
      body: data instanceof FormData ? data : JSON.stringify(data ?? {}),
      headers,
    }),

  put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data ?? {}) }),

  patch: (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data ?? {}) }),

  delete: path => request(path, { method: 'DELETE' }),

  // Fetches a file and triggers a browser download
  download: async (path, filename, retried = false) => {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: authHeaders(),
    })

    if (response.status === 401 && !retried) {
      try {
        await refreshSession()
      } catch (error) {
        accessToken = null
        throw error
      }
      return api.download(path, filename, true)
    }

    if (!response.ok) throw new ApiError('Could not download this file', response.status)

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  },

  // Fetches a file and returns it as a Blob (e.g. for inline PDF preview)
  file: async (path, retried = false) => {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: authHeaders(),
    })

    if (response.status === 401 && !retried) {
      await refreshSession()
      return api.file(path, true)
    }

    if (!response.ok) throw new ApiError('Could not open this file', response.status)
    return response.blob()
  },

  setToken: token => {
    accessToken = token
  },

  clearToken: () => {
    accessToken = null
  },

  baseUrl: API_BASE,
}

export const unwrap = result => result?.data ?? result
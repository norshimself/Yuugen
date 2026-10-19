// Yuugen's browser API uses a same-origin Next.js rewrite. The refresh
// session is an HttpOnly cookie; the short-lived JWT exists only in memory.
const API_URL = '/api/v1';

interface FetchOptions extends RequestInit {
  bodyData?: unknown;
}

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

function clearLegacyTokens() {
  if (typeof window === 'undefined') return;
  // Previous releases stored long-lived tokens here. Never read them again.
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
  clearLegacyTokens();
}

export async function exchangeLoginCode(code: string): Promise<boolean> {
  clearAccessToken();
  try {
    const response = await fetch(`${API_URL}/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-yuugen-client': 'web' },
      body: JSON.stringify({ code }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const data = await response.json();
    if (data?.success && typeof data.access_token === 'string') {
      accessToken = data.access_token;
      return true;
    }
  } catch (error) {
    console.error('Discord sign-in exchange failed:', error);
  }
  return false;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    clearLegacyTokens();
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-yuugen-client': 'web' },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) {
        accessToken = null;
        return null;
      }

      const data = await response.json();
      if (data?.success && typeof data.access_token === 'string') {
        accessToken = data.access_token;
        return accessToken;
      }
      accessToken = null;
      return null;
    } catch (error) {
      console.warn('Unable to refresh session:', error);
      accessToken = null;
      return null;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function logoutSession(): Promise<void> {
  // Clear JavaScript credentials immediately even if the network is offline.
  clearAccessToken();
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-yuugen-client': 'web' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (error) {
    console.warn('Logout request failed:', error);
  }
}

export async function authenticatedFetch(
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> {
  if (!endpoint.startsWith('/') || endpoint.startsWith('//')) {
    throw new Error('API endpoints must be relative paths');
  }

  // No session token is read from localStorage or passed as a URL parameter.
  let token = accessToken || await refreshAccessToken();
  if (!token) {
    clearAccessToken();
    throw new Error('Sign in required');
  }

  const send = (jwt: string) => {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${jwt}`);
    if (options.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  };

  let response = await send(token);
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (!token) {
      throw new Error('Session expired; please sign in again');
    }
    response = await send(token);
  }
  return response;
}

export async function apiClient<T>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  const { bodyData, ...requestOptions } = options;
  if (bodyData !== undefined) {
    requestOptions.body = JSON.stringify(bodyData);
  }
  const response = await authenticatedFetch(endpoint, requestOptions);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `API request failed with status: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

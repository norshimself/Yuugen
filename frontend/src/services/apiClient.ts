// src/services/apiClient.ts

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "4029c9b9b5ad007d8c24a2a51b458dce46674bbbc2ce1acfed1cfcd3cad2623f";

interface FetchOptions extends RequestInit {
  bodyData?: Record<string, any> | any;
}

let refreshPromise: Promise<string | null> | null = null;

/**
 * Shared function to refresh the JWT access token using the refresh token
 * (either from cookie or localStorage fallback). Supports queuing multiple concurrent requests.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const refreshToken = typeof window !== "undefined" ? localStorage.getItem("refresh_token") : null;
    
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          ...(refreshToken ? { "x-refresh-token": refreshToken } : {}),
        },
        body: JSON.stringify({ refreshToken }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to refresh token");
      }

      const data = await response.json();
      if (data.success && data.access_token) {
        if (typeof window !== "undefined") {
          localStorage.setItem("access_token", data.access_token);
          if (data.refresh_token) {
            localStorage.setItem("refresh_token", data.refresh_token);
          }
        }
        return data.access_token;
      }
      return null;
    } catch (error) {
      console.error("Token refresh failed:", error);
      return null;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function apiClient<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("x-api-key", API_KEY);
  
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const config: RequestInit = {
    ...options,
    headers,
    credentials: "include", // Ensure cookies are sent
  };

  if (options.bodyData !== undefined) {
    config.body = JSON.stringify(options.bodyData);
  }

  let response = await fetch(`${API_URL}${endpoint}`, config);

  // If unauthorized and it's not the refresh endpoint itself
  if (response.status === 401 && endpoint !== "/auth/refresh") {
    const newToken = await refreshAccessToken();
    
    if (newToken) {
      // Re-build config and retry
      const retryHeaders = new Headers(options.headers);
      retryHeaders.set("Content-Type", "application/json");
      retryHeaders.set("x-api-key", API_KEY);
      retryHeaders.set("Authorization", `Bearer ${newToken}`);
      
      const retryConfig: RequestInit = {
        ...options,
        headers: retryHeaders,
        credentials: "include",
      };

      if (options.bodyData !== undefined) {
        retryConfig.body = JSON.stringify(options.bodyData);
      }

      response = await fetch(`${API_URL}${endpoint}`, retryConfig);
    } else {
      // Clear tokens and redirect to login if refresh fails
      if (typeof window !== "undefined") {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        window.location.href = "/login";
      }
      throw new Error("Unauthorized session. Redirecting to login...");
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `API request failed with status: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

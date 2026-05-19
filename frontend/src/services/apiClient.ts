// src/services/apiClient.ts

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "4029c9b9b5ad007d8c24a2a51b458dce46674bbbc2ce1acfed1cfcd3cad2623f";

interface FetchOptions extends RequestInit {
  bodyData?: Record<string, any> | any;
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
  };

  if (options.bodyData !== undefined) {
    config.body = JSON.stringify(options.bodyData);
  }

  const response = await fetch(`${API_URL}${endpoint}`, config);

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized session. Redirecting to login...");
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `API request failed with status: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

import axios from 'axios';
import { getAccessToken, refreshAccessToken } from '@/services/apiClient';

// Kept for legacy callers. All browser requests remain same-origin so the
// server-issued refresh cookie is never made available to JavaScript.
const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

api.interceptors.request.use(async (config) => {
  const token = getAccessToken() || await refreshAccessToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;
      const token = await refreshAccessToken();
      if (token) {
        originalRequest.headers.set('Authorization', `Bearer ${token}`);
        return api(originalRequest);
      }
    }
    return Promise.reject(error);
  },
);

export default api;

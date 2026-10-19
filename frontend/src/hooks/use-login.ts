'use client';

// OAuth begins directly on the backend so its short-lived state cookie is
// available to Discord's redirect back to the same backend origin.
const backendApi =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (process.env.NEXT_PUBLIC_API_URL?.startsWith('http') ? process.env.NEXT_PUBLIC_API_URL : null) ||
  'http://localhost:3001/api/v1';

export function useLogin() {
  const handleLogin = () => {
    window.location.assign(`${backendApi}/auth/login`);
  };

  const handleDemoLogin = () => {
    window.location.assign(`${backendApi}/auth/demo`);
  };

  return { handleLogin, handleDemoLogin };
}

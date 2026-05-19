"use client";

export function useLogin() {
  const handleLogin = () => {
    // Dynamically retrieve backend API URL from env and redirect to NestJS Discord OAuth Login
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    window.location.href = `${apiUrl}/auth/login`;
  };

  const handleDemoLogin = () => {
    // Redirect to NestJS Demo Login endpoint
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    window.location.href = `${apiUrl}/auth/demo`;
  };

  return {
    handleLogin,
    handleDemoLogin,
  };
}

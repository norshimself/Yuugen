import type { NextConfig } from 'next';

// Server-side rewrite: the browser always calls /api/v1 on the frontend's
// origin; Vercel/Next forwards it to the backend without exposing cookies to
// third-party browser-cookie restrictions.
const backendOrigin = (
  process.env.BACKEND_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

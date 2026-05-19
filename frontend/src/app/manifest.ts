import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Yuugen Discord Bot',
    short_name: 'Yuugen',
    description: 'A gorgeous modern Discord bot with immersive high-quality music, a balanced global economy, and comprehensive server management tools.',
    start_url: '/',
    display: 'standalone',
    background_color: '#04080c',
    theme_color: '#1e6075',
    icons: [
      {
        src: '/logo.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}

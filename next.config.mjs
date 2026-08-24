/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE : les erreurs TypeScript NE sont PAS ignorées au build. Le projet
  // passe `tsc --noEmit` proprement ; toute régression de typage fera échouer
  // le build (voir tsconfig.json, strict: true).
  // NOTE Next 16 : le lint ESLint n'est plus exécuté au build (l'option
  // `eslint.ignoreDuringBuilds` n'existe plus). Le lint reste disponible via
  // `npm run lint`. Le typage strict TypeScript, lui, est bien enforce au build.
  // Désactiver Turbopack (bug mémoire Windows Next.js 16).
  // Ne PAS definir de bloc `turbo` — sa simple presence reactive le moteur
  // meme si experimental.turbo est false. Webpack est utilise par defaut
  // quand aucun bloc turbo n'est present.
  experimental: {
    // Recommande par la doc Next.js pour reduire l'usage memoire de webpack.
    webpackMemoryOptimizations: true,
  },
  images: {
    // Optimisation reactivee : Next redimensionne, convertit en WebP/AVIF et
    // applique le lazy-load. C'est le principal levier pour la vitesse cote client
    // (le dossier public pesait ~17 Mo d'images pleine resolution servies brutes).
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000,
    remotePatterns: [
      { protocol: 'https', hostname: '*.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ]
  },
  
  // Rewrites to mask internal endpoints
  async rewrites() {
    return [
      // Mask Decart endpoints
      {
        source: '/api/v1/session',
        destination: '/api/decart-session',
      },
      {
        source: '/api/v1/token',
        destination: '/api/decart-token',
      },
      // Mask swap endpoints
      {
        source: '/api/v1/transform',
        destination: '/api/swap/cloud',
      },
      {
        source: '/api/v1/stream',
        destination: '/api/faceswap/stream',
      },
    ]
  },
  
  // Block access to sensitive paths
  async redirects() {
    return [
      {
        source: '/.env',
        destination: '/404',
        permanent: false,
      },
      {
        source: '/.env.local',
        destination: '/404',
        permanent: false,
      },
      {
        source: '/api/test-decart',
        destination: '/404',
        permanent: false,
      },
    ]
  },
  
  // Production optimizations
  productionBrowserSourceMaps: false, // Disable source maps in production

  // Minimize and obfuscate — on garde console.log en prod pour le diagnostic
  // Electron (chapcam-debug.log) et le Live Swap ([Lucy 2.1]/[live]). Le retrait
  // de console.log masquait les logs OBS/virtual-camera sans DevTools.
  compiler: {
    removeConsole: false,
  },
}

export default nextConfig

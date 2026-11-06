/** @type {import('next').NextConfig} */

// Baseline security headers, applied to every response.
//
// Deliberately conservative: these four harden the site without touching
// the app's media features. A strict Content-Security-Policy and a
// Permissions-Policy are intentionally NOT set here, because the live app
// relies on camera/microphone capture (LiveKit) and embedded players, and
// a mis-scoped policy would silently break exactly those. CSP is better
// added later, scoped and tested on staging, than shipped broad to
// production in a hurry.
const securityHeaders = [
  // Force HTTPS for two years, including subdomains.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Stop the browser guessing a response's type (blocks MIME-sniffing attacks).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Do not leak full URLs (which can carry tokens) to other origins.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Do not allow other sites to frame Loudentify (clickjacking).
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise the framework/version
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;

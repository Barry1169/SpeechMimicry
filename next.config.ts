import type { NextConfig } from 'next';

const config: NextConfig = {
  allowedDevOrigins: ['localhost', '127.0.0.1', '*.e2b.app'],
  devIndicators: false,
  poweredByHeader: false,
};
export default config;

import type { NextConfig } from 'next';
const config: NextConfig = { output: 'export', images: { unoptimized: true }, trailingSlash: true, experimental: { workerThreads: true, cpus: 2 } };
export default config;

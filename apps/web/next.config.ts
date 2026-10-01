import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  transpilePackages: [
    '@rswim/ui',
    '@rswim/contracts',
    '@rswim/money',
    '@rswim/calendar',
    '@rswim/db',
  ],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  typedRoutes: false,
  // Lint runs as its own CI step with the shared config.
  eslint: { ignoreDuringBuilds: true },
};

export default withNextIntl(config);

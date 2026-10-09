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
    '@rswim/domain-attendance',
    '@rswim/domain-core',
    '@rswim/domain-crm',
    '@rswim/domain-dive',
    '@rswim/domain-enrollment',
    '@rswim/domain-people',
    '@rswim/domain-scheduling',
    '@rswim/domain-settings',
    '@rswim/domain-staff',
    '@rswim/domain-venues',
    '@rswim/integrations',
  ],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  typedRoutes: false,
  // Lint runs as its own CI step with the shared config.
  eslint: { ignoreDuringBuilds: true },
};

export default withNextIntl(config);

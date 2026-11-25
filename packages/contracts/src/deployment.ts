/**
 * What a production deployment must and must not have in its environment. The worker refuses to start and the web
 * app's health check answers 503 when this finds a problem, so a mistake shows up at deploy time and in the uptime
 * monitor, not as a fake payment or a persona sign-in in front of a real school (docs/saas/DEPLOY.md).
 *
 * Only names are ever reported, never values: the result goes to logs and to a public health endpoint.
 * Staging and local runs are not checked: staging keeps its fakes on until each provider's account exists.
 */

export type DeploymentService = 'web' | 'worker';

/** Switches that only make sense on a laptop, in CI or on the live demo. */
const FORBIDDEN = [
  'RSWIM_DEV_AUTH',
  'RSWIM_DEMO_MODE',
  'RSWIM_PAYMENTS_SANDBOX',
  'RSWIM_PLAIN_POSTGRES',
  'INNGEST_DEV',
] as const;

/** Any RSWIM_*_FAKE (RSWIM_GROW_FAKE, RSWIM_MESSAGING_FAKE, RSWIM_FILES_FAKE...). */
const FAKE_SWITCH = /^RSWIM_[A-Z0-9_]*_FAKE$/;

const REQUIRED: Record<DeploymentService, readonly string[]> = {
  web: [
    'DATABASE_URL',
    'RSWIM_MASTER_KEY',
    'RSWIM_PLATFORM_HOSTS',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ],
  worker: [
    'DATABASE_URL',
    'RSWIM_MASTER_KEY',
    'RSWIM_PLATFORM_HOSTS',
    'RSWIM_PUBLIC_URL',
    'INNGEST_EVENT_KEY',
    'INNGEST_SIGNING_KEY',
  ],
};

function isOn(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

/**
 * The problems of this environment for `service`, as short English lines naming variables only.
 * Empty when RSWIM_ENV is not `production` or when everything is in place.
 */
export function productionEnvProblems(
  service: DeploymentService,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  if (env.RSWIM_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const name of REQUIRED[service]) {
    if (!env[name]) problems.push(`${name} is not set`);
  }
  const forbidden = new Set<string>(FORBIDDEN);
  for (const name of Object.keys(env).sort()) {
    if ((forbidden.has(name) || FAKE_SWITCH.test(name)) && isOn(env[name])) {
      problems.push(`${name} must not be set in production`);
    }
  }
  const publicUrl = env.RSWIM_PUBLIC_URL;
  if (publicUrl && !publicUrl.startsWith('https://')) {
    problems.push('RSWIM_PUBLIC_URL must start with https://');
  }
  return problems;
}

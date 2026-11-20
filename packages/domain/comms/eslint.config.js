import base from '@rswim/config/eslint';

export default [
  ...base,
  // Inbound intake (GHL, ADR-0005; Meta's webhook, W5) is cross-tenant by nature: it alone may use the owner connection.
  {
    files: ['test/**', 'src/services/intake.ts', 'src/services/whatsapp-webhook.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

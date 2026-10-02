import { corePing } from './core-ping';
import { crmApplyWebhook, crmImportContacts, crmPushGuardian } from './crm';
import { outboxRelay } from './outbox-relay';

export const functions = [
  outboxRelay,
  corePing,
  crmPushGuardian,
  crmImportContacts,
  crmApplyWebhook,
];

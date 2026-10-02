import { corePing } from './core-ping';
import { crmApplyWebhook, crmImportContacts, crmPushGuardian } from './crm';
import { outboxRelay } from './outbox-relay';
import { schedulingApplyShiftChange, schedulingEscalateShiftChanges } from './scheduling';

export const functions = [
  outboxRelay,
  corePing,
  crmPushGuardian,
  crmImportContacts,
  crmApplyWebhook,
  schedulingApplyShiftChange,
  schedulingEscalateShiftChanges,
];

import { attendanceNightly, attendanceProcessAbsence } from './attendance';
import {
  billingApplyGrowWebhook,
  billingCancelMandate,
  billingClosureCredits,
  billingCollectRun,
  billingCreateLink,
  billingDailyDunning,
  billingIssueReceipts,
  billingProviderRefund,
  billingTrialOffset,
} from './billing';
import {
  commsAiTriage,
  commsAutomation,
  commsDispatch,
  commsHolidayNotice,
  crmPipelineSync,
} from './comms';
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
  attendanceProcessAbsence,
  attendanceNightly,
  billingCollectRun,
  billingCreateLink,
  billingApplyGrowWebhook,
  billingIssueReceipts,
  billingProviderRefund,
  billingCancelMandate,
  billingTrialOffset,
  billingClosureCredits,
  billingDailyDunning,
  commsAutomation,
  commsDispatch,
  commsHolidayNotice,
  commsAiTriage,
  crmPipelineSync,
];

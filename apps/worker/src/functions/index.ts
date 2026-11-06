import { attendanceNightly, attendanceProcessAbsence } from './attendance';
import {
  billingApplyGrowWebhook,
  billingCancelMandate,
  billingClosureCredits,
  billingCollectRun,
  billingCreateLink,
  billingDailyDunning,
  billingPortalRequest,
  billingPortalRequestSweep,
  billingIssueReceipts,
  billingProviderRefund,
  billingTrialOffset,
} from './billing';
import {
  commsAiTriage,
  commsParentBot,
  commsAutomations,
  commsDispatch,
  commsHolidayNotice,
  brainInbound,
  crmPipelineSync,
} from './comms';
import { brainEveningSummary, brainMemory, brainMorningCheck } from './brain';
import { corePing } from './core-ping';
import { crmApplyWebhook, crmImportContacts, crmPushGuardian } from './crm';
import { outboxRelay } from './outbox-relay';
import {
  schedulingApplyShiftChange,
  schedulingApplySubstitute,
  schedulingEscalateShiftChanges,
  schedulingSubstituteWaves,
} from './scheduling';
import { institutionsPrintInvoice, institutionsPrintReceipt } from './institutions';
import { reportsDailyInsights, reportsWeeklyDigest } from './reports';
import {
  platformBillSchool,
  platformCheckDomain,
  platformDaily,
  platformMonthlyBilling,
  platformSchoolCreated,
} from './platform';
import { diveDailyReminders } from './dive';
import { platformProvisionDatabase, platformSyncSchool } from './tenancy';
import { transportPlanRuns } from './transport';

export const functions = [
  outboxRelay,
  transportPlanRuns,
  reportsWeeklyDigest,
  reportsDailyInsights,
  platformSchoolCreated,
  platformProvisionDatabase,
  platformSyncSchool,
  platformCheckDomain,
  platformBillSchool,
  platformMonthlyBilling,
  platformDaily,
  institutionsPrintInvoice,
  institutionsPrintReceipt,
  corePing,
  crmPushGuardian,
  crmImportContacts,
  crmApplyWebhook,
  schedulingApplyShiftChange,
  schedulingEscalateShiftChanges,
  schedulingApplySubstitute,
  schedulingSubstituteWaves,
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
  billingPortalRequest,
  billingPortalRequestSweep,
  diveDailyReminders,
  ...commsAutomations,
  commsDispatch,
  commsHolidayNotice,
  commsAiTriage,
  commsParentBot,
  brainInbound,
  brainMorningCheck,
  brainEveningSummary,
  brainMemory,
  crmPipelineSync,
];

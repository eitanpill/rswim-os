import { corePing } from './core-ping';
import { outboxRelay } from './outbox-relay';

export const functions = [outboxRelay, corePing];

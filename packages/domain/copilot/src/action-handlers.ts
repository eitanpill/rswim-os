/**
 * Brain kinds carried out by an optional module that the brain cannot depend on (lodging holds a room with
 * `book_lodging`). The module registers its handler once where it is loaded (the worker, the web app's brain
 * screens); the brain runs it on approval and undoes it like its own kinds.
 */
import type { Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import type { ProposalParams } from './policies';

export type ModuleKind = 'book_lodging';

/** What each module kind returns when it ran (kept on the action, handed back to undo it). */
export interface ModuleResults {
  book_lodging: { bookingId: string; stayIds: string[]; payUrl: string | null };
}

export interface ActionHandler<K extends ModuleKind = ModuleKind> {
  execute(tx: Tx, ctx: ServiceContext, params: ProposalParams[K]): Promise<ModuleResults[K]>;
  undo(tx: Tx, ctx: ServiceContext, result: ModuleResults[K]): Promise<void>;
}

const HANDLERS = new Map<ModuleKind, ActionHandler>();

/** Registering the same kind again replaces it (a hot reload). */
export function registerActionHandler<K extends ModuleKind>(kind: K, h: ActionHandler<K>): void {
  HANDLERS.set(kind, h as unknown as ActionHandler);
}

export function actionHandler(kind: ModuleKind): ActionHandler {
  const h = HANDLERS.get(kind);
  if (!h) throw new DomainError('agent.errors.moduleOff');
  return h;
}

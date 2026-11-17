/**
 * The platform's card callback (SaaS stage 3). It names no school, only the setup the processor echoes, so it runs on
 * the owner connection like the other webhook intakes (ADR-0005); the SQL function lands the card on that setup's
 * school only.
 */
import type { Db } from '@rswim/db';
import { asPlatform } from '@rswim/db/service';
import type { CardSetupEvent } from '@rswim/integrations';
import { completeCardSetup } from './subscription';

/** Completes a verified callback's card setup. Returns the school's id. */
export function ingestCardSetup(db: Db, event: CardSetupEvent): Promise<string> {
  return asPlatform(db, (tx) => completeCardSetup(tx, event));
}

/**
 * Brain kinds that optional modules carry out (lodging's `book_lodging`). The owner approves them on the brain and
 * copilot screens, so the web app registers their handlers as the worker does.
 */
import { registerLodgingActions } from '@rswim/domain-lodging';
import { requestOrigin } from './payments';

registerLodgingActions(requestOrigin);

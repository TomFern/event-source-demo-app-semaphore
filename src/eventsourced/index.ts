import { startAPI } from '#core/api';
import { disconnectFromPostgres } from '#core/postgres';
import { disconnectFromEventStore } from './core/streams';
import { router } from './carts/routes';
import { runSubscription } from './subscriptions';

process.once('SIGTERM', disconnectFromPostgres);
process.once('SIGTERM', disconnectFromEventStore);

startAPI(router);

(async () => {
  await runSubscription();
})().catch(console.error);

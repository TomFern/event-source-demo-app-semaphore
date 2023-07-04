import {
  handleEventInPostgresTransactionScope,
  SubscriptionToAllWithPostgresCheckpoints,
} from './core/subscriptions';
import { projectToShoppingCartItem } from './carts/cartDetails';

export const runSubscription = () =>
  SubscriptionToAllWithPostgresCheckpoints('sub_carts', [
    handleEventInPostgresTransactionScope([projectToShoppingCartItem]),
  ]);

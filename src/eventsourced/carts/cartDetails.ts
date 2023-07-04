import { getPostgres } from '#core/postgres';
import { sql, Transaction } from '@databases/pg';
import { SubscriptionResolvedEvent } from '../core/subscriptions';
import { cartItems, carts } from '../db';
import {
  isCashierShoppingCartEvent,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartErrors,
  ShoppingCartOpened,
  ShoppingCartStatus,
} from './cart';

export const getShoppingCarts = () => carts(getPostgres());
export const getShoppingCartItemss = () => cartItems(getPostgres());

export const projectToShoppingCartItem = (
  db: Transaction,
  resolvedEvent: SubscriptionResolvedEvent
): Promise<void> => {
  if (
    resolvedEvent.event === undefined ||
    !isCashierShoppingCartEvent(resolvedEvent.event)
  )
    return Promise.resolve();

  const { event } = resolvedEvent;
  const streamRevision = Number(event.revision);

  switch (event.type) {
    case 'cart-opened':
      return projectShoppingCartOpened(db, event, streamRevision);
    case 'product-item-added-to-cart':
      return projectProductItemAddedToShoppingCart(db, event, streamRevision);
    case 'product-item-removed-from-cart':
      return projectProductItemRemovedFromShoppingCart(
        db,
        event,
        streamRevision
      );
    case 'cart-confirmed':
      return projectShoppingCartConfirmed(db, event, streamRevision);
    default: {
      const _: never = event;
      throw new Error(ShoppingCartErrors.UNKNOWN_EVENT_TYPE);
    }
  }
};

export const projectShoppingCartOpened = async (
  db: Transaction,
  event: ShoppingCartOpened,
  streamRevision: number
): Promise<void> => {
  const Carts = carts(db);

  await Carts.insertOrIgnore({
    sessionId: event.data.CartId,
    createdAt: new Date(event.data.openedAt),
    status: ShoppingCartStatus.Opened,
    revision: streamRevision,
  });
};

export const projectProductItemAddedToShoppingCart = async (
  db: Transaction,
  event: ProductItemAddedToShoppingCart,
  streamRevision: number
): Promise<void> => {
  const {
    CartId,
    productItem: { productId, quantity, discount, price, sku },
    addedAt,
  } = event.data;

  const { wasApplied, cartId } = await wasAlreadyApplied(
    db,
    CartId,
    new Date(addedAt),
    streamRevision
  );

  if (wasApplied) return;

  const CartsItems = cartItems(db);

  await db.query(
    sql`
    INSERT INTO ${CartsItems.tableId} as ci ("cartId", "productId", "sku", "price", "discount", "quantity", "createdAt")
    VALUES (${cartId}, ${productId}, ${sku}, ${price}, ${discount}, ${quantity}, ${addedAt})
    ON CONFLICT ("cartId", "productId") DO UPDATE SET "quantity" = EXCLUDED."quantity" + ci."quantity", "updatedAt" = ${addedAt};
    `
  );
};

export const projectProductItemRemovedFromShoppingCart = async (
  db: Transaction,
  event: ProductItemRemovedFromShoppingCart,
  streamRevision: number
): Promise<void> => {
  const {
    CartId,
    productItem: { productId, quantity },
    removedAt,
  } = event.data;

  const { wasApplied, cartId } = await wasAlreadyApplied(
    db,
    CartId,
    new Date(removedAt),
    streamRevision
  );

  if (wasApplied) return;

  const CartsItems = cartItems(db);

  await db.query(
    sql`
    UPDATE ${CartsItems.tableId}
    SET "quantity" = "quantity" - ${quantity}, "updatedAt" = ${removedAt}
    WHERE "cartId" = ${cartId} AND "productId" = ${productId};
    
    DELETE FROM ${CartsItems.tableId}
    WHERE "cartId" = ${cartId} AND "productId" = ${productId} AND "quantity" = 0;
    `
  );
};

export const projectShoppingCartConfirmed = async (
  db: Transaction,
  event: ShoppingCartConfirmed,
  streamRevision: number
): Promise<void> => {
  const Carts = carts(db);

  const {
    CartId,
    user: {
      id: userId,
      firstName,
      lastName,
      middleName,
      mobile,
      email,
      address,
    },
    additionalInfo,
    confirmedAt,
  } = event.data;

  await Carts.update(
    { sessionId: CartId, revision: streamRevision - 1 },
    {
      revision: streamRevision,
      userId,
      firstName,
      lastName,
      middleName,
      mobile,
      email,
      ...additionalInfo,
      ...address,
      status: ShoppingCartStatus.Confirmed,
      updatedAt: new Date(confirmedAt),
    }
  );
};

const wasAlreadyApplied = async (
  db: Transaction,
  CartId: string,
  updatedAt: Date,
  streamRevision: number
) => {
  const Carts = carts(db);
  const result = await Carts.update(
    { sessionId: CartId, revision: streamRevision - 1 },
    {
      revision: streamRevision,
      updatedAt,
    }
  );

  return {
    wasApplied: result.length === 0,
    cartId: result.length > 0 ? result[0].id : undefined,
  };
};

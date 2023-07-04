import {
  getExpectedRevisionFromIfMatch,
  getExpectedRevisionFromIfNotMatch,
  sendCreated,
  toWeakETag,
} from '#core/http';
import { getPostgres, retryIfNotFound } from '#core/postgres';
import {
  assertNotEmptyString,
  assertPositiveNumber,
  assertStringOrUndefined,
} from '#core/validation';
import { not, WhereCondition } from '@databases/pg-typed';
import { NextFunction, Request, Response, Router } from 'express';
import { v4 as uuid } from 'uuid';
import { create, update } from '../core/commandHandling';
import { getEventStore } from '../core/streams';
import { cartItems, carts } from '../db';
import { Cart } from '../db/__generated__';
import { getPricedProductItem } from './productItem';
import {
  AddProductItemToShoppingCart,
  addProductItemToShoppingCart,
  ConfirmShoppingCart,
  confirmShoppingCart,
  openShoppingCart,
  removeProductItemFromShoppingCart,
  ShoppingCartEvent,
  toShoppingCartStreamName,
} from './cart';
import { getUserData } from './user';

export const router = Router();

router.post(
  '/v2/carts/:CartId?',
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const CartId = assertStringOrUndefined(request.params.CartId) ?? uuid();
      const streamName = toShoppingCartStreamName(CartId);

      const result = await create(getEventStore(), openShoppingCart)(
        streamName,
        {
          CartId,
        }
      );

      response.set('ETag', toWeakETag(result.nextExpectedRevision));
      sendCreated(response, CartId);
    } catch (error) {
      console.error(error);
      next(error);
    }
  }
);

type AddProductItemRequest = Request<
  Partial<{ CartId: string }>,
  unknown,
  Partial<{ productId: number; quantity: number }>
>;
router.post(
  '/v2/carts/:CartId/product-items',
  async (
    request: AddProductItemRequest,
    response: Response,
    next: NextFunction
  ) => {
    try {
      const CartId = assertNotEmptyString(request.params.CartId);
      const streamName = toShoppingCartStreamName(CartId);
      const expectedRevision = getExpectedRevisionFromIfMatch(request);

      const result = await update<
        AddProductItemToShoppingCart,
        ShoppingCartEvent
      >(getEventStore(), (events, command) =>
        addProductItemToShoppingCart(getPricedProductItem, events, command)
      )(
        streamName,
        {
          CartId: assertNotEmptyString(request.params.CartId),
          productItem: {
            productId: assertPositiveNumber(request.body.productId),
            quantity: assertPositiveNumber(request.body.quantity),
          },
        },
        expectedRevision
      );

      response.set('ETag', toWeakETag(result.nextExpectedRevision));
      response.sendStatus(200);
    } catch (error) {
      console.error(error);
      next(error);
    }
  }
);

///////////////////////////////
// Remove Product Item
///////////////////////////////
type RemoveProductItemRequest = Request<
  Partial<{ CartId: string }>,
  unknown,
  unknown,
  Partial<{ productId: number; quantity: number }>
>;

router.delete(
  '/v2/carts/:CartId/product-items',
  async (
    request: RemoveProductItemRequest,
    response: Response,
    next: NextFunction
  ) => {
    try {
      const CartId = assertNotEmptyString(request.params.CartId);
      const streamName = toShoppingCartStreamName(CartId);
      const expectedRevision = getExpectedRevisionFromIfMatch(request);

      const result = await update(
        getEventStore(),
        removeProductItemFromShoppingCart
      )(
        streamName,
        {
          CartId: assertNotEmptyString(request.params.CartId),
          productItem: {
            productId: assertPositiveNumber(Number(request.query.productId)),
            quantity: assertPositiveNumber(Number(request.query.quantity)),
          },
        },
        expectedRevision
      );

      response.set('ETag', toWeakETag(result.nextExpectedRevision));
      response.sendStatus(200);
    } catch (error) {
      console.error(error);
      next(error);
    }
  }
);

type ConfirmProductItemRequest = Request<
  Partial<{ CartId: string; userId: string }>,
  unknown,
  Partial<{ content: string; line1: string; line2: string }>
>;

router.put(
  '/v2/users/:userId/carts/:CartId',
  async (
    request: ConfirmProductItemRequest,
    response: Response,
    next: NextFunction
  ) => {
    try {
      const CartId = assertNotEmptyString(request.params.CartId);
      const streamName = toShoppingCartStreamName(CartId);
      const expectedRevision = getExpectedRevisionFromIfMatch(request);

      const result = await update<ConfirmShoppingCart, ShoppingCartEvent>(
        getEventStore(),
        (events, command) => confirmShoppingCart(getUserData, events, command)
      )(
        streamName,
        {
          CartId: assertNotEmptyString(request.params.CartId),
          userId: assertPositiveNumber(Number(request.params.userId)),
          additionalInfo: {
            content: assertStringOrUndefined(request.body.content),
            line1: assertStringOrUndefined(request.body.line1),
            line2: assertStringOrUndefined(request.body.line2),
          },
        },
        expectedRevision
      );

      response.set('ETag', toWeakETag(result.nextExpectedRevision));
      response.sendStatus(200);
    } catch (error) {
      console.error(error);
      next(error);
    }
  }
);

router.get(
  '/v2/carts/:CartId',
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      const Carts = carts(getPostgres());
      const CartItems = cartItems(getPostgres());
      const expectedRevision = getExpectedRevisionFromIfNotMatch(request);

      let query: WhereCondition<Cart> = {
        sessionId: assertNotEmptyString(request.params.CartId),
      };

      if (expectedRevision != undefined) {
        query = {
          ...query,
          revision: not(Number(expectedRevision)),
        };
      }

      const result = await retryIfNotFound(() => Carts.findOne(query));

      if (result === null) {
        response.sendStatus(404);
        return;
      }

      const items = await CartItems.find({
        cartId: result.id,
      }).all();

      response.set('ETag', toWeakETag(result.revision));
      response.send({
        ...result,
        items: items.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        ),
      });
    } catch (error) {
      console.error(error);
      next(error);
    }
  }
);

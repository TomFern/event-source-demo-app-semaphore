import {
  JSONEventType,
  JSONRecordedEvent,
  RecordedEvent,
  ResolvedEvent,
  StreamingRead,
} from '@eventstore/db-client';
import { StreamAggregator } from '../core/streams';
import {
  addProductItem,
  assertProductItemExists,
  PricedProductItem,
  ProductItem,
  removeProductItem,
} from './productItem';
import { User } from './user';

//////////////////////////////////////
/// Events
//////////////////////////////////////

export type ShoppingCartOpened = JSONEventType<
  'cart-opened',
  {
    CartId: string;
    openedAt: string;
  }
>;

export type ProductItemAddedToShoppingCart = JSONEventType<
  'product-item-added-to-cart',
  {
    CartId: string;
    productItem: PricedProductItem;
    addedAt: string;
  }
>;

export type ProductItemRemovedFromShoppingCart = JSONEventType<
  'product-item-removed-from-cart',
  {
    CartId: string;
    productItem: PricedProductItem;
    removedAt: string;
  }
>;

export type ShoppingCartConfirmed = JSONEventType<
  'cart-confirmed',
  {
    CartId: string;
    user: User;

    additionalInfo: {
      content?: string;
      line1?: string;
      line2?: string;
    };
    confirmedAt: string;
  }
>;

export type ShoppingCartEvent =
  | ShoppingCartOpened
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed;

export const isCashierShoppingCartEvent = (
  event: RecordedEvent | null
): event is ShoppingCartEvent & JSONRecordedEvent => {
  return (
    event != null &&
    (event.type === 'cart-opened' ||
      event.type === 'product-item-added-to-cart' ||
      event.type === 'product-item-removed-from-cart' ||
      event.type === 'cart-confirmed')
  );
};

//////////////////////////////////////
/// Entity/State
//////////////////////////////////////

export const enum ShoppingCartStatus {
  Opened = 1,
  Confirmed = 2,
  Cancelled = 4,
  Closed = Confirmed | Cancelled,
}

export interface ShoppingCart {
  id: string;
  status: ShoppingCartStatus;
  productItems: PricedProductItem[];
}

export const enum ShoppingCartErrors {
  OPENED_EXISTING_CART = 'OPENED_EXISTING_CART',
  CART_IS_NOT_OPENED = 'CART_IS_NOT_OPENED',
  USER_DOES_NOT_EXISTS = 'USER_DOES_NOT_EXISTS',
  NO_PRODUCTS_ITEMS = 'NO_PRODUCTS_ITEMS',
  PRODUCT_ITEM_NOT_FOUND = 'PRODUCT_ITEM_NOT_FOUND',
  UNKNOWN_EVENT_TYPE = 'UNKNOWN_EVENT_TYPE',
}

export const toShoppingCartStreamName = (CartId: string) => `cart-${CartId}`;

export const assertShoppingCartIsOpened = (Cart: ShoppingCart) => {
  if (Cart.status !== ShoppingCartStatus.Opened) {
    throw new Error(ShoppingCartErrors.CART_IS_NOT_OPENED);
  }
};

export const assertHasProductItems = (Cart: ShoppingCart) => {
  if (Cart.productItems.length === 0) {
    throw new Error(ShoppingCartErrors.NO_PRODUCTS_ITEMS);
  }
};

//////////////////////////////////////
/// Getting the state from events
//////////////////////////////////////

export const getShoppingCart = StreamAggregator<
  ShoppingCart,
  ShoppingCartEvent
>((currentState, event) => {
  switch (event.type) {
    case 'cart-opened':
      return {
        id: event.data.CartId,
        openedAt: new Date(event.data.openedAt),
        productItems: [],
        status: ShoppingCartStatus.Opened,
      };
    case 'product-item-added-to-cart':
      return {
        ...currentState,
        productItems: addProductItem(
          currentState.productItems,
          event.data.productItem
        ),
      };
    case 'product-item-removed-from-cart':
      return {
        ...currentState,
        productItems: removeProductItem(
          currentState.productItems,
          event.data.productItem
        ),
      };
    case 'cart-confirmed':
      return {
        ...currentState,
        status: ShoppingCartStatus.Confirmed,
      };
    default: {
      const _: never = event;
      console.error(`Unknown event type %s`, event);
      return currentState;
    }
  }
});

//////////////////////////////////////
/// Open  cart
//////////////////////////////////////

export type OpenShoppingCart = {
  CartId: string;
};

export const openShoppingCart = ({
  CartId,
}: OpenShoppingCart): ShoppingCartOpened => {
  return {
    type: 'cart-opened',
    data: {
      CartId,
      openedAt: new Date().toJSON(),
    },
  };
};

//////////////////////////////////////
/// Add product item to  cart
//////////////////////////////////////

export type AddProductItemToShoppingCart = {
  CartId: string;
  productItem: ProductItem;
};

export const addProductItemToShoppingCart = async (
  getPricedProduct: (productItem: ProductItem) => Promise<PricedProductItem>,
  events: StreamingRead<ResolvedEvent<ShoppingCartEvent>>,
  { CartId, productItem }: AddProductItemToShoppingCart
): Promise<ProductItemAddedToShoppingCart> => {
  const Cart = await getShoppingCart(events);

  assertShoppingCartIsOpened(Cart);

  const pricedProductItem = await getPricedProduct(productItem);

  return {
    type: 'product-item-added-to-cart',
    data: {
      CartId,
      productItem: pricedProductItem,
      addedAt: new Date().toJSON(),
    },
  };
};

//////////////////////////////////////
/// Remove product item to  cart
//////////////////////////////////////

export type RemoveProductItemFromShoppingCart = {
  CartId: string;
  productItem: ProductItem;
};

export const removeProductItemFromShoppingCart = async (
  events: StreamingRead<ResolvedEvent<ShoppingCartEvent>>,
  { CartId, productItem }: RemoveProductItemFromShoppingCart
): Promise<ProductItemRemovedFromShoppingCart> => {
  const Cart = await getShoppingCart(events);

  assertShoppingCartIsOpened(Cart);

  const current = assertProductItemExists(Cart.productItems, productItem);

  return {
    type: 'product-item-removed-from-cart',
    data: {
      CartId,
      productItem: { ...current, quantity: productItem.quantity },
      removedAt: new Date().toJSON(),
    },
  };
};

export type ConfirmShoppingCart = {
  CartId: string;
  userId: number;
  additionalInfo: {
    content?: string;
    line1?: string;
    line2?: string;
  };
};

export const confirmShoppingCart = async (
  getUserData: (userId: number) => Promise<User | undefined>,
  events: StreamingRead<ResolvedEvent<ShoppingCartEvent>>,
  { CartId, additionalInfo, userId }: ConfirmShoppingCart
): Promise<ShoppingCartConfirmed> => {
  const Cart = await getShoppingCart(events);

  assertShoppingCartIsOpened(Cart);
  assertHasProductItems(Cart);

  const user = await getUserData(userId);

  if (!user) {
    throw ShoppingCartErrors.USER_DOES_NOT_EXISTS;
  }

  return {
    type: 'cart-confirmed',
    data: {
      CartId,
      user,
      additionalInfo,
      confirmedAt: new Date().toJSON(),
    },
  };
};

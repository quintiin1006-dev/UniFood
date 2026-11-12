"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Minus, Plus, ShoppingCart } from "lucide-react";
import { currency } from "../domain/catalog";
import {
  MAX_CART_UNITS,
  MAX_PER_PRODUCT,
  maxQuantity,
  OTHER_CAFETERIA_MESSAGE,
  orderBlocker,
  quantityInCart,
} from "../domain/cart";
import { categoryName, menuCategories, menuHref } from "../domain/menu";
import type { CafeteriaMenu, MenuProduct } from "../types";
import { useClientCart } from "./ClientCartProvider";
import CafeteriaSelector from "./CafeteriaSelector";
import ProductPlaceholder from "./ProductPlaceholder";
import styles from "./ClientShopping.module.css";

type ProductProps = {
  siteName: string;
  menu: CafeteriaMenu;
  product: MenuProduct;
};

export default function ClientProduct(props: ProductProps) {
  const { cart } = useClientCart();
  const inCart =
    cart.cafeteriaId === props.menu.cafeteria.id
      ? quantityInCart(cart, props.product.id)
      : 0;
  // Remount when the stored quantity changes, so the selector starts from it.
  return (
    <ProductDetails
      key={`${props.product.id}-${inCart}`}
      {...props}
      inCart={inCart}
    />
  );
}

function ProductDetails({
  siteName,
  menu,
  product,
  inCart,
}: ProductProps & { inCart: number }) {
  const { cart, ready, add, update } = useClientCart();
  const [quantity, setQuantity] = useState(inCart || 1);
  const conflict =
    cart.lines.length > 0 && cart.cafeteriaId !== menu.cafeteria.id
      ? OTHER_CAFETERIA_MESSAGE
      : "";
  const blocker = orderBlocker(menu, product);
  const maximum = conflict ? 0 : maxQuantity(cart, product.id);
  const reason =
    conflict ||
    blocker ||
    (maximum === 0
      ? `Tu carrito ya tiene ${MAX_CART_UNITS} unidades, el máximo por pedido.`
      : quantity > maximum
        ? `Puedes seleccionar hasta ${maximum} unidad${maximum === 1 ? "" : "es"}.`
        : "");
  const unchanged = inCart > 0 && quantity === inCart;
  const slug = menuCategories.find(({ id }) => id === product.category)!.slug;
  return (
    <section className={styles.shopping} aria-labelledby="product-title">
      <Link className={styles.back} href={menuHref(menu.cafeteria.id, slug)}>
        <ArrowLeft size={22} aria-hidden="true" />
        Volver al menú
      </Link>
      <CafeteriaSelector siteName={siteName} cafeteria={menu.cafeteria} />
      <ProductPlaceholder name={product.name} size="hero" />
      <div>
        <p className={styles.eyebrow}>{categoryName(product.category)}</p>
        <h1 id="product-title">{product.name}</h1>
        {product.description && (
          <p className={styles.description}>{product.description}</p>
        )}
        <strong className={styles.productPrice}>
          {currency.format(product.price)}
        </strong>
      </div>
      <form
        className={styles.productForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || reason || unchanged) return;
          if (inCart) update(menu, product.id, quantity);
          else add(menu, product.id, quantity);
        }}
      >
        <div className={styles.quantityRow}>
          <div>
            <label id="quantity-label">Cantidad</label>
            <p>
              Máximo {MAX_PER_PRODUCT} por producto y {MAX_CART_UNITS} por
              pedido.
            </p>
            {inCart > 0 && (
              <p>
                Ya tienes {inCart} en el carrito. Ajusta la cantidad y guarda
                los cambios.
              </p>
            )}
          </div>
          <div
            className={styles.quantity}
            role="group"
            aria-labelledby="quantity-label"
          >
            <button
              type="button"
              aria-label="Reducir cantidad"
              disabled={!ready || quantity <= 1}
              onClick={() => setQuantity((value) => value - 1)}
            >
              <Minus size={19} aria-hidden="true" />
            </button>
            <output aria-label="Cantidad seleccionada">{quantity}</output>
            <button
              type="button"
              aria-label="Aumentar cantidad"
              disabled={!ready || quantity >= maximum || !!blocker}
              onClick={() =>
                setQuantity((value) => Math.min(maximum, value + 1))
              }
            >
              <Plus size={19} aria-hidden="true" />
            </button>
          </div>
        </div>
        {reason && (
          <p
            className={styles.notice}
            role="status"
            aria-label="Disponibilidad del producto"
          >
            {reason}
          </p>
        )}
        {conflict && (
          <Link className={styles.secondaryButton} href="/cuenta/carrito">
            Revisar carrito
          </Link>
        )}
        <div className={styles.purchase}>
          <div>
            <span>{inCart ? "Total actualizado" : "Total del producto"}</span>
            <strong>{currency.format(product.price * quantity)}</strong>
          </div>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!ready || !!reason || unchanged}
          >
            <ShoppingCart size={20} aria-hidden="true" />
            {inCart ? "Actualizar carrito" : "Agregar al carrito"}
          </button>
        </div>
      </form>
    </section>
  );
}

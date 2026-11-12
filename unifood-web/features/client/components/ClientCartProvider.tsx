"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";
import {
  addProduct,
  cartCount,
  emptyCart,
  restoreCart,
  setQuantity,
} from "../domain/cart";
import { reviewCheckout, type CheckoutResult } from "../domain/checkout";
import type { CafeteriaMenu, ClientCart } from "../types";
import { forgetCachedCafeteria } from "../state";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./ClientShopping.module.css";

// v2 keys lines by real productId and cafeteriaId; v1 carts held mock ids and are dropped.
export const CART_STORAGE_KEY = "unifood.client.cart.v2";
const LEGACY_CART_STORAGE_KEY = "unifood.client.cart.v1";
const HOURS_PREVIEW_KEY = "unifood.client.hours-preview.v1";
type CartContextValue = {
  cart: ClientCart;
  ready: boolean;
  count: number;
  ignoreServiceHours: boolean;
  setIgnoreServiceHours: (enabled: boolean) => void;
  add: (menu: CafeteriaMenu, productId: string, quantity: number) => boolean;
  remove: (productId: string) => void;
  /** Sets a line's quantity; null on success, otherwise the reason it was refused. */
  update: (
    menu: CafeteriaMenu | null,
    productId: string,
    quantity: number,
  ) => string | null;
  confirmCheckout: (
    expectedCart: ClientCart,
    menu: CafeteriaMenu | null,
    pickupAt: string,
    accepted: boolean,
  ) => CheckoutResult;
  clear: () => void;
  chooseCafeteria: (cafeteriaId: string, proceed: () => void) => void;
};
const CartContext = createContext<CartContextValue | null>(null);
export function useClientCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("ClientCartProvider is required");
  return value;
}

export default function ClientCartProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [cart, setCart] = useState<ClientCart>(emptyCart);
  const current = useRef<ClientCart>(emptyCart());
  const storageSynced = useRef(false);
  const [ready, setReady] = useState(false);
  const [ignoreServiceHours, setHoursPreview] = useState(false);
  const setIgnoreServiceHours = (enabled: boolean) => {
    if (process.env.NODE_ENV !== "development") return;
    setHoursPreview(enabled);
    try {
      if (enabled) sessionStorage.setItem(HOURS_PREVIEW_KEY, userId);
      else sessionStorage.removeItem(HOURS_PREVIEW_KEY);
    } catch {
      // The preview still works in memory when browser storage is unavailable.
    }
  };
  const [toast, setToast] = useState<{
    message: string;
    success: boolean;
  } | null>(null);
  const [pendingCafeteria, setPendingCafeteria] = useState<{
    proceed: () => void;
  } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const persist = useCallback(
    (next: ClientCart) => {
      current.current = next;
      setCart(next);
      try {
        localStorage.setItem(
          CART_STORAGE_KEY,
          JSON.stringify({ ownerId: userId, cart: next }),
        );
        storageSynced.current = true;
      } catch {
        storageSynced.current = false;
        setToast({
          message:
            "Tu carrito está disponible en esta pestaña, pero no se pudo guardar para la próxima recarga.",
          success: false,
        });
      }
    },
    [userId],
  );
  useEffect(() => {
    const read = () => {
      let next = emptyCart();
      try {
        localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        const saved = raw ? JSON.parse(raw) : null;
        if (saved?.ownerId === userId) next = restoreCart(saved.cart);
        else if (saved) localStorage.removeItem(CART_STORAGE_KEY);
        storageSynced.current = true;
      } catch {
        storageSynced.current = false;
        /* Private browsing or invalid storage never prevents browsing. */
      }
      current.current = next;
      setCart(next);
      setReady(true);
    };
    const timer = setTimeout(() => {
      if (process.env.NODE_ENV === "development") {
        try {
          const owner = sessionStorage.getItem(HOURS_PREVIEW_KEY);
          setHoursPreview(owner === userId);
          if (owner && owner !== userId)
            sessionStorage.removeItem(HOURS_PREVIEW_KEY);
        } catch {
          // Start with normal hours if browser storage is unavailable.
        }
      }
      read();
    }, 0);
    const logout = () => {
      current.current = emptyCart();
      setCart(emptyCart());
      setHoursPreview(false);
      try {
        sessionStorage.removeItem(HOURS_PREVIEW_KEY);
      } catch {
        // Storage unavailable.
      }
      try {
        localStorage.removeItem(CART_STORAGE_KEY);
      } catch {
        /* Storage unavailable. */
      }
      forgetCachedCafeteria();
    };
    const sync = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY || event.key === null) read();
    };
    window.addEventListener("storage", sync);
    window.addEventListener("unifood:logout", logout);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("storage", sync);
      window.removeEventListener("unifood:logout", logout);
    };
  }, [userId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const add: CartContextValue["add"] = (menu, productId, quantity) => {
    if (!ready) return false;
    const result = addProduct(current.current, menu, productId, quantity);
    if (result.error) {
      setToast({ message: result.error, success: false });
      return false;
    }
    setToast({
      message:
        quantity === 1
          ? "Producto agregado al carrito"
          : `${quantity} unidades agregadas al carrito`,
      success: true,
    });
    persist(result.cart);
    return true;
  };
  const remove = (productId: string) => {
    const result = setQuantity(current.current, null, productId, 0);
    persist(result.cart);
    setToast({ message: "Producto eliminado del carrito", success: false });
  };
  const update: CartContextValue["update"] = (menu, productId, quantity) => {
    if (!ready) return "Espera a que termine de cargar el carrito.";
    const result = setQuantity(current.current, menu, productId, quantity);
    if (result.error) {
      setToast({ message: result.error, success: false });
      return result.error;
    }
    setToast({ message: "Carrito actualizado", success: false });
    persist(result.cart);
    return null;
  };
  const confirmCheckout: CartContextValue["confirmCheckout"] = (
    expectedCart,
    menu,
    pickupAt,
    accepted,
  ) => {
    if (!ready)
      return { ok: false, error: "Espera a que termine de cargar el carrito." };
    let latest = current.current;
    try {
      if (storageSynced.current) {
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        try {
          const saved = raw ? JSON.parse(raw) : null;
          latest =
            saved?.ownerId === userId ? restoreCart(saved.cart) : emptyCart();
        } catch {
          latest = emptyCart();
        }
      }
    } catch {
      // The in-memory cart remains usable when storage is unavailable.
    }
    if (JSON.stringify(latest) !== JSON.stringify(expectedCart)) {
      current.current = latest;
      setCart(latest);
      setToast({
        message: "El carrito cambió. Revisa el resumen actualizado.",
        success: false,
      });
      return {
        ok: false,
        error:
          "El carrito cambió. Revisa el resumen actualizado y vuelve a confirmar.",
      };
    }
    return reviewCheckout(
      latest,
      menu,
      pickupAt,
      accepted,
      new Date(),
      ignoreServiceHours,
    );
  };
  const chooseCafeteria: CartContextValue["chooseCafeteria"] = (
    cafeteriaId,
    proceed,
  ) => {
    if (
      current.current.lines.length &&
      current.current.cafeteriaId !== cafeteriaId
    )
      setPendingCafeteria({ proceed });
    else proceed();
  };
  return (
    <CartContext.Provider
      value={{
        cart,
        ready,
        count: cartCount(cart),
        ignoreServiceHours,
        setIgnoreServiceHours,
        add,
        remove,
        update,
        confirmCheckout,
        clear: () => setConfirmClear(true),
        chooseCafeteria,
      }}
    >
      {children}
      <div className={styles.toastRegion} aria-live="polite" aria-atomic="true">
        {toast && (
          <div className={styles.toast}>
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>{toast.message}</span>
            {toast.success && <Link href="/cuenta/carrito">Ver carrito</Link>}
            <button
              type="button"
              aria-label="Cerrar aviso"
              onClick={() => setToast(null)}
            >
              <X size={19} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {pendingCafeteria && (
        <ConfirmDialog
          title="¿Cambiar de cafetería?"
          confirmLabel="Vaciar y cambiar"
          onCancel={() => setPendingCafeteria(null)}
          onConfirm={() => {
            persist(emptyCart());
            pendingCafeteria.proceed();
            setPendingCafeteria(null);
          }}
        >
          <p>
            Tu carrito tiene productos de otra cafetería. Para continuar en
            esta, necesitas vaciarlo.
          </p>
        </ConfirmDialog>
      )}
      {confirmClear && (
        <ConfirmDialog
          title="¿Vaciar tu carrito?"
          confirmLabel="Vaciar carrito"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            persist(emptyCart());
            setConfirmClear(false);
          }}
        >
          <p>Se eliminarán todos los productos que has agregado.</p>
        </ConfirmDialog>
      )}
    </CartContext.Provider>
  );
}

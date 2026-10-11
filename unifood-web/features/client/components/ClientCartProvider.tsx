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
  addMeal,
  cartCount,
  emptyCart,
  restoreCart,
  updateMeal,
} from "../domain/cart";
import { reviewCheckout, type CheckoutResult } from "../domain/checkout";
import type { ClientCart } from "../types";
import ConfirmDialog from "./ConfirmDialog";
import styles from "./ClientShopping.module.css";

export const CART_STORAGE_KEY = "unifood.client.cart.v1";
const HOURS_PREVIEW_KEY = "unifood.client.hours-preview.v1";
type CartContextValue = {
  cart: ClientCart;
  ready: boolean;
  count: number;
  ignoreServiceHours: boolean;
  setIgnoreServiceHours: (enabled: boolean) => void;
  add: (
    siteId: string,
    mealId: string,
    quantity: number,
    notes: string,
  ) => boolean;
  remove: (id: string) => void;
  update: (
    id: string,
    changes: { quantity?: number; notes?: string },
  ) => string | null;
  confirmCheckout: (
    expectedCart: ClientCart,
    pickupAt: string,
    accepted: boolean,
  ) => CheckoutResult;
  clear: () => void;
  chooseSite: (siteId: string, proceed: () => void) => void;
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
  const [pendingSite, setPendingSite] = useState<{
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
  const add: CartContextValue["add"] = (siteId, mealId, quantity, notes) => {
    if (!ready) return false;
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = addMeal(
      current.current,
      siteId,
      mealId,
      quantity,
      notes,
      new Date(),
      id,
      ignoreServiceHours,
    );
    if (result.error) {
      setToast({ message: result.error, success: false });
      return false;
    }
    setToast({
      message:
        quantity === 1
          ? "Plato agregado al carrito"
          : `${quantity} platos agregados al carrito`,
      success: true,
    });
    persist(result.cart);
    return true;
  };
  const remove = (id: string) => {
    const lines = current.current.lines.filter((line) => line.id !== id);
    persist(lines.length ? { ...current.current, lines } : emptyCart());
    setToast({ message: "Plato eliminado del carrito", success: false });
  };
  const update: CartContextValue["update"] = (id, changes) => {
    if (!ready) return "Espera a que termine de cargar el carrito.";
    const result = updateMeal(
      current.current,
      id,
      changes,
      new Date(),
      ignoreServiceHours,
    );
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
      pickupAt,
      accepted,
      new Date(),
      ignoreServiceHours,
    );
  };
  const chooseSite: CartContextValue["chooseSite"] = (siteId, proceed) => {
    if (current.current.lines.length && current.current.siteId !== siteId)
      setPendingSite({ proceed });
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
        chooseSite,
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
      {pendingSite && (
        <ConfirmDialog
          title="¿Cambiar de cafetería?"
          confirmLabel="Vaciar y cambiar"
          onCancel={() => setPendingSite(null)}
          onConfirm={() => {
            persist(emptyCart());
            pendingSite.proceed();
            setPendingSite(null);
          }}
        >
          <p>
            Tu carrito contiene platos de otra cafetería. Para continuar en esta
            sede, necesitas vaciarlo.
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
          <p>Se eliminarán todos los platos que has agregado.</p>
        </ConfirmDialog>
      )}
    </CartContext.Provider>
  );
}

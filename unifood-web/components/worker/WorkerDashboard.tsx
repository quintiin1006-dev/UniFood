"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Header from "@/components/worker/Header";
import KanbanBoard from "@/components/worker/KanbanBoard";
import CallsBoard from "@/components/worker/CallsBoard";
import OrderDetail from "@/components/worker/OrderDetail";
import BottomNav, {
  type WorkerModule,
} from "@/components/worker/BottomNav";

import { useOrders } from "@/features/orders/hooks/useOrders";

import type { Order } from "@/types/order";

export default function WorkerDashboard() {
  const {
    orders,
    busyOrderIds,
    loading,
    error,
    actionError,
    isPriorityError,
    handleOrderAction,
    handleOrderCancel,
    clearActionError,
  } = useOrders();

  const [
    selectedOrder,
    setSelectedOrder,
  ] = useState<Order | null>(
    null
  );

  const [
    orderToCancel,
    setOrderToCancel,
  ] = useState<Order | null>(
    null
  );

  const [search, setSearch] =
    useState("");

  const [
    activeModule,
    setActiveModule,
  ] = useState<WorkerModule>(
    "orders"
  );

  const [, setNow] =
    useState(0);

  /* =========================================================
     ACTUALIZACIÓN DE TIEMPOS
     ========================================================= */

  useEffect(() => {
    const intervalId =
      setInterval(() => {
        setNow(Date.now());
      }, 30_000);

    return () => {
      clearInterval(
        intervalId
      );
    };
  }, []);

  /* =========================================================
     FILTRO GENERAL DE PEDIDOS
     ========================================================= */

  const filteredOrders =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return orders;
      }

      return orders.filter(
        (order) => {
          const matchesStudent =
            order.student
              .toLowerCase()
              .includes(query);

          const matchesId =
            order.studentId
              .toLowerCase()
              .includes(query);

          const matchesProduct =
            order.items.some(
              (item) =>
                item.name
                  .toLowerCase()
                  .includes(query)
            );

          return (
            matchesStudent ||
            matchesId ||
            matchesProduct
          );
        }
      );
    }, [orders, search]);

  /* =========================================================
     PEDIDOS AVISADOS
     ========================================================= */

  const calledOrders =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      return orders.filter(
        (order) => {
          if (
            order.status !==
            "called"
          ) {
            return false;
          }

          if (!query) {
            return true;
          }

          const matchesStudent =
            order.student
              .toLowerCase()
              .includes(query);

          const matchesId =
            order.studentId
              .toLowerCase()
              .includes(query);

          const matchesProduct =
            order.items.some(
              (item) =>
                item.name
                  .toLowerCase()
                  .includes(query)
            );

          return (
            matchesStudent ||
            matchesId ||
            matchesProduct
          );
        }
      );
    }, [orders, search]);

  /* =========================================================
     AVANZAR PEDIDO
     ========================================================= */

  const onOrderAction =
    async (
      order: Order
    ) => {
      const updatedOrder =
        await handleOrderAction(
          order
        );

      if (!updatedOrder) {
        return;
      }

      setSelectedOrder(
        (currentOrder) =>
          currentOrder?.id ===
          updatedOrder.id
            ? updatedOrder
            : currentOrder
      );
    };

  /* =========================================================
     AVISAR NUEVAMENTE

     Por ahora solamente frontend.

     No hacemos fetch aquí porque la notificación
     real deberá conectarse posteriormente con
     el backend.
     ========================================================= */

  const onRemindOrder =
    (order: Order) => {
      console.info(
        "Avisar nuevamente:",
        order.id
      );
    };

  /* =========================================================
     SOLICITAR CANCELACIÓN
     ========================================================= */

  const onRequestCancel =
    (order: Order) => {
      if (
        order.status !==
        "pending"
      ) {
        return;
      }

      setOrderToCancel(
        order
      );
    };

  /* =========================================================
     CONFIRMAR CANCELACIÓN
     ========================================================= */

  const onConfirmCancel =
    async () => {
      if (!orderToCancel) {
        return;
      }

      const cancelledOrder =
        await handleOrderCancel(
          orderToCancel
        );

      if (!cancelledOrder) {
        return;
      }

      setOrderToCancel(
        null
      );

      setSelectedOrder(
        (currentOrder) =>
          currentOrder?.id ===
          cancelledOrder.id
            ? null
            : currentOrder
      );
    };

  /* =========================================================
     CAMBIO DE MÓDULO
     ========================================================= */

  const handleModuleChange =
    (
      module: WorkerModule
    ) => {
      setActiveModule(
        module
      );

      setSelectedOrder(
        null
      );

      setSearch("");

      clearActionError();
    };

  /* =========================================================
     RENDERIZADO DE MÓDULOS
     ========================================================= */

  const renderModule =
    () => {
      /* =====================================================
         PEDIDOS
         ===================================================== */

      if (
        activeModule ===
        "orders"
      ) {
        if (loading) {
          return (
            <section
              style={{
                flex: 1,
                display:
                  "grid",
                placeItems:
                  "center",
                color:
                  "rgba(255,255,255,.8)",
              }}
            >
              <p>
                Cargando pedidos...
              </p>
            </section>
          );
        }

        if (error) {
          return (
            <section
              style={{
                flex: 1,
                display:
                  "grid",
                placeItems:
                  "center",
                color:
                  "rgba(255,255,255,.8)",
              }}
            >
              <p>
                {error}
              </p>
            </section>
          );
        }

        return (
          <KanbanBoard
            busyOrderIds={busyOrderIds}
            orders={
              filteredOrders
            }
            onOpenOrder={
              setSelectedOrder
            }
            onAction={
              onOrderAction
            }
            onCancel={
              onRequestCancel
            }
          />
        );
      }

      /* =====================================================
         LLAMADAS
         ===================================================== */

      if (
        activeModule ===
        "calls"
      ) {
        return (
          <CallsBoard
            busyOrderIds={busyOrderIds}
            orders={
              calledOrders
            }
            selectedOrder={
              orders.find((order) => order.id === selectedOrder?.id && order.status === "called") ?? null
            }
            search={search}
            onSearchChange={
              setSearch
            }
            onSelectOrder={
              setSelectedOrder
            }
            onDeliver={
              onOrderAction
            }
            onRemind={
              onRemindOrder
            }
          />
        );
      }

      /* =====================================================
         OTROS MÓDULOS
         ===================================================== */

      return (
        <section
          style={{
            flex: 1,
            display:
              "grid",
            placeItems:
              "center",
            color:
              "rgba(255,255,255,.7)",
          }}
        >
          <p>
            Módulo de{" "}
            <strong>
              {
                activeModule
              }
            </strong>
          </p>
        </section>
      );
    };

  /* =========================================================
     RENDER PRINCIPAL
     ========================================================= */

  return (
    <main
      className="worker-page"
    >
      <Header
        search={search}
        onSearchChange={
          setSearch
        }
      />

      <div
        className="worker-main"
      >
        {renderModule()}
      </div>

      {/* =====================================================
          NAVEGACIÓN INFERIOR
          ===================================================== */}

      <BottomNav
        activeModule={
          activeModule
        }
        onChange={
          handleModuleChange
        }
      />

      {/* =====================================================
          DETALLE DE PEDIDO
          ===================================================== */}

      {activeModule ===
        "orders" && (
        <OrderDetail
          busy={busyOrderIds.includes(selectedOrder?.id ?? "")}
          order={
            orders.find((order) => order.id === selectedOrder?.id) ?? null
          }
          onClose={() =>
            setSelectedOrder(
              null
            )
          }
          onAction={
            onOrderAction
          }
        />
      )}

      {/* =====================================================
          MODAL DE CANCELACIÓN
          ===================================================== */}

      {orderToCancel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-order-title"
          style={{
            position:
              "fixed",
            inset: 0,
            zIndex: 9998,
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            background:
              "rgba(0, 0, 0, 0.28)",
            backdropFilter:
              "blur(5px)",
            padding:
              "24px",
          }}
        >
          <div
            style={{
              width:
                "min(440px, 100%)",
              background:
                "#ffffff",
              borderRadius:
                "24px",
              padding:
                "28px",
              boxShadow:
                "0 24px 70px rgba(0,0,0,.25)",
            }}
          >
            <h2
              id="cancel-order-title"
              style={{
                margin:
                  "0 0 10px",
                fontSize:
                  "20px",
                fontWeight:
                  700,
                color:
                  "#172033",
              }}
            >
              ¿Cancelar pedido?
            </h2>

            <p
              style={{
                margin:
                  "0 0 8px",
                fontSize:
                  "15px",
                lineHeight:
                  1.5,
                color:
                  "#5d6678",
              }}
            >
              Vas a cancelar
              el pedido de{" "}
              <strong>
                {
                  orderToCancel.student
                }
              </strong>
              .
            </p>

            <p
              style={{
                margin:
                  "0 0 24px",
                fontSize:
                  "14px",
                lineHeight:
                  1.5,
                color:
                  "#7a8394",
              }}
            >
              Esta acción es
              definitiva. El
              pedido dejará de
              aparecer en la
              lista de pedidos
              activos.
            </p>

            <div
              style={{
                display:
                  "grid",
                gridTemplateColumns:
                  "1fr 1fr",
                gap: "10px",
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setOrderToCancel(
                    null
                  )
                }
                style={{
                  border:
                    "1px solid #d9dee8",
                  borderRadius:
                    "14px",
                  padding:
                    "13px 18px",
                  background:
                    "#ffffff",
                  color:
                    "#172033",
                  fontSize:
                    "15px",
                  fontWeight:
                    600,
                  cursor:
                    "pointer",
                }}
              >
                Volver
              </button>

              <button
                type="button"
                onClick={
                  onConfirmCancel
                }
                disabled={busyOrderIds.includes(orderToCancel.id)}
                style={{
                  border:
                    "none",
                  borderRadius:
                    "14px",
                  padding:
                    "13px 18px",
                  background:
                    "#dc2626",
                  color:
                    "#ffffff",
                  fontSize:
                    "15px",
                  fontWeight:
                    600,
                  cursor:
                    "pointer",
                }}
              >
                Cancelar pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          ERROR DE ACCIÓN
          ===================================================== */}

      {actionError && (
        <div
          role="alert"
          onClick={
            clearActionError
          }
          style={{
            position:
              "fixed",
            inset: 0,
            zIndex: 9999,
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            background:
              "rgba(0, 0, 0, 0.18)",
            backdropFilter:
              "blur(4px)",
            padding:
              "24px",
            cursor:
              "pointer",
          }}
        >
          <div
            onClick={(event) =>
              event.stopPropagation()
            }
            style={{
              width:
                "min(440px, 100%)",
              background:
                "rgba(255, 255, 255, 0.98)",
              borderRadius:
                "24px",
              padding:
                "28px",
              boxShadow:
                "0 24px 70px rgba(0,0,0,.25)",
              textAlign:
                "center",
              cursor:
                "default",
            }}
          >
            <div
              style={{
                width:
                  "56px",
                height:
                  "56px",
                margin:
                  "0 auto 16px",
                borderRadius:
                  "50%",
                display:
                  "grid",
                placeItems:
                  "center",
                background:
                  "#fee2e2",
                color:
                  "#dc2626",
                fontSize:
                  "28px",
                fontWeight:
                  700,
              }}
            >
              !
            </div>

            <h2
              style={{
                margin:
                  "0 0 10px",
                fontSize:
                  "20px",
                fontWeight:
                  700,
                color:
                  "#172033",
              }}
            >
              {isPriorityError
                ? "Acción no disponible"
                : "No se pudo completar la acción"}
            </h2>

            <p
              style={{
                margin:
                  "0 0 24px",
                fontSize:
                  "15px",
                lineHeight:
                  1.5,
                color:
                  "#5d6678",
              }}
            >
              {actionError}
            </p>

            <button
              type="button"
              onClick={
                clearActionError
              }
              style={{
                width:
                  "100%",
                border:
                  "none",
                borderRadius:
                  "14px",
                padding:
                  "13px 18px",
                background:
                  "#0b63ce",
                color:
                  "#ffffff",
                fontSize:
                  "15px",
                fontWeight:
                  600,
                cursor:
                  "pointer",
              }}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

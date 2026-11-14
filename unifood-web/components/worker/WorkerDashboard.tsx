"use client";

import { useEffect, useMemo, useState } from "react";

import Header from "@/components/worker/Header";
import KanbanBoard from "@/components/worker/KanbanBoard";
import CallsBoard from "@/components/worker/CallsBoard";
import OrderDetail from "@/components/worker/OrderDetail";
import BottomNav, { type WorkerModule } from "@/components/worker/BottomNav";

import { useOrders } from "@/features/orders/hooks/useOrders";
import { RejectOrderDialog } from "@/features/orders/components/RejectOrderDialog";
import { OrderActionAlert } from "@/features/orders/components/OrderActionAlert";
import {
  BoardAnnouncer,
  BoardError,
  BoardLoading,
  SearchEmpty,
  StaleListingBanner,
} from "@/features/orders/components/BoardFeedback";
import {
  listingErrorView,
  syncStatusLabel,
} from "@/features/orders/listingStatus";

import type { Order } from "@/types/order";
import { AvailabilityPanel } from "@/features/availability/components/AvailabilityPanel";
import { WorkerHistoryPanel } from "@/features/worker-history/components/WorkerHistoryPanel";
import { WorkerProfilePanel } from "@/features/worker-profile/components/WorkerProfilePanel";
import styles from "./WorkerDashboard.module.css";

export default function WorkerDashboard() {
  const [activeModule, setActiveModule] = useState<WorkerModule>("orders");
  const {
    orders,
    busyOrderIds,
    busyActions,
    loading,
    actionError,
    isPriorityError,
    handleOrderAction,
    handleOrderReject,
    handleCalledOrderAction,
    clearActionError,
    syncFailure,
    lastSyncedAt,
    announcement,
    newOrderIds,
    retry,
  } = useOrders(activeModule === "orders" || activeModule === "calls");

  const [retrying, setRetrying] = useState(false);

  const onRetry = () => {
    setRetrying(true);
    void retry().finally(() => setRetrying(false));
  };

  const clearSearch = () => {
    setSearch("");
    document.getElementById("worker-search-input")?.focus();
  };

  /* W1, W2 and L1: the same truthful states for Pedidos and Llamadas. */
  const listingView = syncFailure ? listingErrorView(syncFailure) : null;
  const listingBlocked =
    !!listingView && (listingView.withdraw || lastSyncedAt === null);
  const listingModule = activeModule === "orders" || activeModule === "calls";

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [orderToReject, setOrderToReject] = useState<Order | null>(null);

  const [search, setSearch] = useState("");

  const [now, setNow] = useState(() => Date.now());

  /* =========================================================
     ACTUALIZACIÓN DE TIEMPOS
     ========================================================= */

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 30_000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  /* =========================================================
     FILTRO GENERAL DE PEDIDOS
     ========================================================= */

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return orders;
    }

    return orders.filter((order) => {
      const matchesStudent = order.student.toLowerCase().includes(query);

      const matchesId = (order.clientCode ?? "").toLowerCase().includes(query);

      const matchesProduct = order.items.some((item) =>
        item.name.toLowerCase().includes(query),
      );

      return matchesStudent || matchesId || matchesProduct;
    });
  }, [orders, search]);

  /* =========================================================
     PEDIDOS AVISADOS
     ========================================================= */

  const calledOrders = useMemo(() => {
    const query = search.trim().toLowerCase();

    return orders.filter((order) => {
      if (order.status !== "called") {
        return false;
      }

      if (!query) {
        return true;
      }

      const matchesStudent = order.student.toLowerCase().includes(query);

      const matchesId = (order.clientCode ?? "").toLowerCase().includes(query);

      const matchesProduct = order.items.some((item) =>
        item.name.toLowerCase().includes(query),
      );

      return matchesStudent || matchesId || matchesProduct;
    });
  }, [orders, search]);

  /* =========================================================
     AVANZAR PEDIDO
     ========================================================= */

  const onOrderAction = async (order: Order) => {
    const updatedOrder = await handleOrderAction(order);

    if (!updatedOrder) {
      return;
    }

    setSelectedOrder((currentOrder) =>
      currentOrder?.id === updatedOrder.id ? updatedOrder : currentOrder,
    );
  };

  /* =========================================================
     AVISAR NUEVAMENTE Y NO RECOGIDO

     La lógica y los mensajes viven en features/orders;
     el tablero se refresca al terminar.
     ========================================================= */

  const onRemindOrder = (order: Order) => {
    void handleCalledOrderAction(order, "remind");
  };

  const onNotCollectedOrder = async (order: Order) => {
    const updated = await handleCalledOrderAction(order, "not-collected");
    if (updated)
      setSelectedOrder((current) =>
        current?.id === updated.id ? null : current,
      );
  };

  /* =========================================================
     CAMBIO DE MÓDULO
     ========================================================= */

  const handleModuleChange = (module: WorkerModule) => {
    setActiveModule(module);

    setSelectedOrder(null);

    setOrderToReject(null);

    setSearch("");

    clearActionError();
  };

  /* =========================================================
     RENDERIZADO DE MÓDULOS
     ========================================================= */

  const renderModule = () => {
    if (activeModule === "availability") return <AvailabilityPanel />;
    if (activeModule === "history") return <WorkerHistoryPanel />;
    if (activeModule === "profile") return <WorkerProfilePanel />;
    /* =====================================================
         PEDIDOS
         ===================================================== */

    if (listingModule && listingBlocked && listingView)
      return (
        <BoardError view={listingView} retrying={retrying} onRetry={onRetry} />
      );

    if (listingModule && loading && lastSyncedAt === null)
      return <BoardLoading />;

    if (activeModule === "orders") {
      // W5: a search without matches says so instead of four «No hay pedidos».
      if (search.trim() && filteredOrders.length === 0)
        return <SearchEmpty query={search} onClear={clearSearch} />;

      return (
        <KanbanBoard
          busyOrderIds={busyOrderIds}
          orders={filteredOrders}
          newOrderIds={newOrderIds}
          now={now}
          onOpenOrder={setSelectedOrder}
          onAction={onOrderAction}
          onReject={setOrderToReject}
        />
      );
    }

    /* =====================================================
         LLAMADAS
         ===================================================== */

    if (activeModule === "calls") {
      return (
        <CallsBoard
          busyOrderIds={busyOrderIds}
          busyActions={busyActions}
          now={now}
          orders={calledOrders}
          selectedOrder={
            orders.find(
              (order) =>
                order.id === selectedOrder?.id && order.status === "called",
            ) ?? null
          }
          search={search}
          onSearchChange={setSearch}
          onClearSearch={clearSearch}
          onSelectOrder={setSelectedOrder}
          onDeliver={onOrderAction}
          onRemind={onRemindOrder}
          onNotCollected={onNotCollectedOrder}
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
          display: "grid",
          placeItems: "center",
          color: "rgba(255,255,255,.7)",
        }}
      >
        <p>
          Módulo de <strong>{activeModule}</strong>
        </p>
      </section>
    );
  };

  /* =========================================================
     RENDER PRINCIPAL
     ========================================================= */

  return (
    <main
      className={`worker-page${activeModule === "availability" ? ` ${styles.availabilityPage}` : activeModule === "history" ? ` ${styles.historyPage}` : activeModule === "profile" ? ` ${styles.profilePage}` : ""}`}
    >
      <Header
        activeModule={activeModule}
        search={search}
        onSearchChange={setSearch}
        syncStatus={
          listingModule
            ? syncStatusLabel(lastSyncedAt, syncFailure !== null)
            : undefined
        }
      />

      <div className="worker-main">
        {listingModule && listingView && !listingBlocked && (
          <StaleListingBanner retrying={retrying} onRetry={onRetry} />
        )}
        {renderModule()}
      </div>

      {listingModule && <BoardAnnouncer message={announcement} />}

      {/* =====================================================
          NAVEGACIÓN INFERIOR
          ===================================================== */}

      <BottomNav activeModule={activeModule} onChange={handleModuleChange} />

      {/* =====================================================
          DETALLE DE PEDIDO
          ===================================================== */}

      {activeModule === "orders" && (
        <OrderDetail
          busy={busyOrderIds.includes(selectedOrder?.id ?? "")}
          order={orders.find((order) => order.id === selectedOrder?.id) ?? null}
          onClose={() => setSelectedOrder(null)}
          onAction={onOrderAction}
        />
      )}

      {activeModule === "orders" && orderToReject && (
        <RejectOrderDialog
          order={orderToReject}
          onClose={() => setOrderToReject(null)}
          onConfirm={async (order, reason) => {
            const result = await handleOrderReject(order, reason);
            if ("order" in result)
              setSelectedOrder((current) =>
                current?.id === result.order.id ? null : current,
              );
            return result;
          }}
        />
      )}

      {/* =====================================================
          ERROR DE ACCIÓN
          ===================================================== */}

      {actionError &&
        (activeModule === "orders" || activeModule === "calls") && (
          <OrderActionAlert
            title={
              isPriorityError
                ? "Acción no disponible"
                : "No se pudo completar la acción"
            }
            message={actionError}
            onClose={clearActionError}
          />
        )}
    </main>
  );
}

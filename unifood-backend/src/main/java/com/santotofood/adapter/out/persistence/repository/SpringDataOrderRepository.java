package com.santotofood.adapter.out.persistence.repository;

import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.domain.model.OrderStatus;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataOrderRepository extends JpaRepository<OrderEntity, UUID> {

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select o from OrderEntity o where o.id = :orderId")
  Optional<OrderEntity> findByIdForUpdate(@Param("orderId") UUID orderId);

  @Query("select o.cafeteriaId from OrderEntity o where o.id = :orderId")
  Optional<UUID> findCafeteriaId(@Param("orderId") UUID orderId);

  @Query(
      value = "SELECT id FROM public.cafeterias WHERE id = :cafeteriaId FOR UPDATE",
      nativeQuery = true)
  UUID lockCafeteriaQueue(@Param("cafeteriaId") UUID cafeteriaId);

  List<OrderEntity> findByCafeteriaIdOrderByCreatedAtAscIdAsc(UUID cafeteriaId);

  @Query(
      "select o from OrderEntity o where o.cafeteriaId = :cafeteriaId and (o.status in :activeStatuses or (o.status = :delivered and o.deliveredAt >= :start and o.deliveredAt < :end)) order by o.createdAt asc, o.id asc")
  List<OrderEntity> findOperational(
      @Param("cafeteriaId") UUID cafeteriaId,
      @Param("delivered") OrderStatus delivered,
      @Param("activeStatuses") List<OrderStatus> activeStatuses,
      @Param("start") Instant start,
      @Param("end") Instant end);

  Optional<OrderEntity> findFirstByCafeteriaIdAndStatusOrderByCreatedAtAscIdAsc(
      UUID cafeteriaId, OrderStatus status);
}

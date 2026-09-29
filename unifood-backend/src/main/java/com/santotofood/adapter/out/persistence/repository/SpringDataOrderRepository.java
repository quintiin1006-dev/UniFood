package com.santotofood.adapter.out.persistence.repository;

import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.domain.model.OrderStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SpringDataOrderRepository
        extends JpaRepository<OrderEntity, UUID> {

    List<OrderEntity> findByCafeteriaIdOrderByCreatedAtAscIdAsc(
            UUID cafeteriaId
    );

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<OrderEntity> findFirstByCafeteriaIdAndStatusOrderByCreatedAtAscIdAsc(
            UUID cafeteriaId,
            OrderStatus status
    );
}
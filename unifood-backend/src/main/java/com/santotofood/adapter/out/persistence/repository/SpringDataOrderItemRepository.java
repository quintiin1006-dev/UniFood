package com.santotofood.adapter.out.persistence.repository;

import com.santotofood.adapter.out.persistence.entity.OrderItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface SpringDataOrderItemRepository
        extends JpaRepository<OrderItemEntity, UUID> {

    List<OrderItemEntity> findByOrderId(UUID orderId);

    List<OrderItemEntity> findByOrderIdInOrderByOrderIdAscIdAsc(
            Collection<UUID> orderIds
    );
}
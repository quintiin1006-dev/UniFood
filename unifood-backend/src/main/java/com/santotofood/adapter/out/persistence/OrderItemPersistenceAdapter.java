package com.santotofood.adapter.out.persistence;

import com.santotofood.adapter.out.persistence.entity.OrderItemEntity;
import com.santotofood.adapter.out.persistence.mapper.OrderItemMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderItemRepository;
import com.santotofood.domain.model.OrderItem;
import com.santotofood.domain.port.out.OrderItemRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class OrderItemPersistenceAdapter
        implements OrderItemRepository {

    private final SpringDataOrderItemRepository repository;
    private final OrderItemMapper mapper;

    @Override
    public OrderItem save(OrderItem orderItem) {

        OrderItemEntity entity =
                mapper.toEntity(orderItem);

        OrderItemEntity savedEntity =
                repository.save(entity);

        return mapper.toDomain(savedEntity);
    }

    @Override
    public List<OrderItem> findByOrderId(UUID orderId) {

        return repository
                .findByOrderId(orderId)
                .stream()
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    public List<OrderItem> findByOrderIds(
            Collection<UUID> orderIds
    ) {

        if (orderIds == null || orderIds.isEmpty()) {
            return List.of();
        }

        return repository
                .findByOrderIdInOrderByOrderIdAscIdAsc(orderIds)
                .stream()
                .map(mapper::toDomain)
                .toList();
    }
}
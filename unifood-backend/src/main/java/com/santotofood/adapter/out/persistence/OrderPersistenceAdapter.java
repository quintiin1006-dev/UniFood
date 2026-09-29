package com.santotofood.adapter.out.persistence;

import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.adapter.out.persistence.mapper.OrderMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderRepository;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderStatus;
import com.santotofood.domain.port.out.OrderRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
@RequiredArgsConstructor
public class OrderPersistenceAdapter implements OrderRepository {

    private final SpringDataOrderRepository repository;
    private final OrderMapper mapper;

    @Override
    public Order save(Order order) {

        OrderEntity entity = mapper.toEntity(order);

        OrderEntity savedEntity = repository.save(entity);

        return mapper.toDomain(savedEntity);
    }

    @Override
    public Optional<Order> findById(UUID orderId) {

        return repository.findById(orderId)
                .map(mapper::toDomain);
    }

    @Override
    public List<Order> findByCafeteriaId(UUID cafeteriaId) {

        return repository
                .findByCafeteriaIdOrderByCreatedAtAscIdAsc(cafeteriaId)
                .stream()
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    public Optional<Order> findFirstPendingByCafeteriaId(
            UUID cafeteriaId
    ) {

        return repository
                .findFirstByCafeteriaIdAndStatusOrderByCreatedAtAscIdAsc(
                        cafeteriaId,
                        OrderStatus.PENDING
                )
                .map(mapper::toDomain);
    }
}
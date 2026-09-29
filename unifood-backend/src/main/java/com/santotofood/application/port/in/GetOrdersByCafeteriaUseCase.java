package com.santotofood.application.port.in;

import com.santotofood.domain.model.Order;

import java.util.List;
import java.util.UUID;

public interface GetOrdersByCafeteriaUseCase {

    List<Order> getOrdersByCafeteria(UUID cafeteriaId);
}
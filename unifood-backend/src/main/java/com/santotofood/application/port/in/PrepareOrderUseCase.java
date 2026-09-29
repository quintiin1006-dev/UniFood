package com.santotofood.application.port.in;

import com.santotofood.domain.model.Order;

import java.util.UUID;

public interface PrepareOrderUseCase {

    Order prepareOrder(UUID orderId);
}
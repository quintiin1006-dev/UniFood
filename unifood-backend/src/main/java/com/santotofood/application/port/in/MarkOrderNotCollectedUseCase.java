package com.santotofood.application.port.in;

import com.santotofood.domain.model.Order;

import java.util.UUID;

public interface MarkOrderNotCollectedUseCase {

    Order markOrderNotCollected(UUID orderId);
}
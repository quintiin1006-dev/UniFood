package com.santotofood.domain.port.out;

import java.util.UUID;

public interface PushNotificationPort {

    void sendOrderCalled(
            UUID clientId,
            UUID orderId
    );

    void sendOrderReminder(
            UUID clientId,
            UUID orderId
    );

    void sendOrderCancelled(
            UUID clientId,
            UUID orderId
    );
}
package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.OrderResponse;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.port.in.CallStudentUseCase;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.DeliverOrderUseCase;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.application.port.in.MarkOrderReadyUseCase;
import com.santotofood.application.port.in.PrepareOrderUseCase;
import com.santotofood.domain.model.Order;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {

    private final PrepareOrderUseCase prepareOrderUseCase;
    private final MarkOrderReadyUseCase markOrderReadyUseCase;
    private final CallStudentUseCase callStudentUseCase;
    private final DeliverOrderUseCase deliverOrderUseCase;
    private final CancelOrderUseCase cancelOrderUseCase;
    private final GetOrdersByCafeteriaUseCase getOrdersByCafeteriaUseCase;
    private final OrderResponseMapper orderResponseMapper;

    @GetMapping
    public ResponseEntity<List<OrderResponse>> getOrdersByCafeteria(
            @RequestParam UUID cafeteriaId
    ) {

        List<OrderResponse> response =
                getOrdersByCafeteriaUseCase
                        .getOrdersByCafeteria(cafeteriaId)
                        .stream()
                        .map(orderResponseMapper::toResponse)
                        .toList();

        return ResponseEntity.ok(response);
    }

    @PatchMapping("/{orderId}/prepare")
    public ResponseEntity<OrderResponse> prepareOrder(
            @PathVariable UUID orderId
    ) {

        Order updatedOrder =
                prepareOrderUseCase.prepareOrder(orderId);

        return ResponseEntity.ok(
                orderResponseMapper.toResponse(
                        updatedOrder
                )
        );
    }

    @PatchMapping("/{orderId}/ready")
    public ResponseEntity<OrderResponse> markOrderReady(
            @PathVariable UUID orderId
    ) {

        Order updatedOrder =
                markOrderReadyUseCase.markOrderReady(orderId);

        return ResponseEntity.ok(
                orderResponseMapper.toResponse(
                        updatedOrder
                )
        );
    }

    @PatchMapping("/{orderId}/call")
    public ResponseEntity<OrderResponse> callStudent(
            @PathVariable UUID orderId
    ) {

        Order updatedOrder =
                callStudentUseCase.callStudent(orderId);

        return ResponseEntity.ok(
                orderResponseMapper.toResponse(
                        updatedOrder
                )
        );
    }

    @PatchMapping("/{orderId}/deliver")
    public ResponseEntity<OrderResponse> deliverOrder(
            @PathVariable UUID orderId
    ) {

        Order updatedOrder =
                deliverOrderUseCase.deliverOrder(orderId);

        return ResponseEntity.ok(
                orderResponseMapper.toResponse(
                        updatedOrder
                )
        );
    }

    @PatchMapping("/{orderId}/cancel")
    public ResponseEntity<OrderResponse> cancelOrder(
            @PathVariable UUID orderId
    ) {

        Order updatedOrder =
                cancelOrderUseCase.cancelOrder(orderId);

        return ResponseEntity.ok(
                orderResponseMapper.toResponse(
                        updatedOrder
                )
        );
    }
}
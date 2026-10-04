package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.error.GlobalExceptionHandler;
import com.santotofood.adapter.in.web.mapper.OrderResponseMapper;
import com.santotofood.application.port.in.CallStudentUseCase;
import com.santotofood.application.port.in.CancelOrderUseCase;
import com.santotofood.application.port.in.DeliverOrderUseCase;
import com.santotofood.application.port.in.GetOrdersByCafeteriaUseCase;
import com.santotofood.application.port.in.MarkOrderReadyUseCase;
import com.santotofood.application.port.in.PrepareOrderUseCase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class OrderControllerApiErrorTest {

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {

        PrepareOrderUseCase prepareOrderUseCase =
                mock(PrepareOrderUseCase.class);

        MarkOrderReadyUseCase markOrderReadyUseCase =
                mock(MarkOrderReadyUseCase.class);

        CallStudentUseCase callStudentUseCase =
                mock(CallStudentUseCase.class);

        DeliverOrderUseCase deliverOrderUseCase =
                mock(DeliverOrderUseCase.class);

        CancelOrderUseCase cancelOrderUseCase =
                mock(CancelOrderUseCase.class);

        GetOrdersByCafeteriaUseCase getOrdersByCafeteriaUseCase =
                mock(GetOrdersByCafeteriaUseCase.class);

        OrderResponseMapper orderResponseMapper =
                mock(OrderResponseMapper.class);

        OrderController orderController =
                new OrderController(
                        prepareOrderUseCase,
                        markOrderReadyUseCase,
                        callStudentUseCase,
                        deliverOrderUseCase,
                        cancelOrderUseCase,
                        getOrdersByCafeteriaUseCase,
                        orderResponseMapper
                );

        mockMvc =
                MockMvcBuilders
                        .standaloneSetup(orderController)
                        .setControllerAdvice(
                                new GlobalExceptionHandler()
                        )
                        .build();
    }

    @Test
    void shouldReturnBadRequestWhenCafeteriaIdIsNotValidUuid()
            throws Exception {

        mockMvc.perform(
                        get("/api/orders")
                                .param(
                                        "cafeteriaId",
                                        "not-a-valid-uuid"
                                )
                )
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.status")
                                .value(400)
                )
                .andExpect(
                        jsonPath("$.code")
                                .value("INVALID_REQUEST")
                )
                .andExpect(
                        jsonPath("$.message")
                                .value(
                                        "El valor proporcionado para 'cafeteriaId' no tiene el formato esperado"
                                )
                )
                .andExpect(
                        jsonPath("$.path")
                                .value("/api/orders")
                )
                .andExpect(
                        jsonPath("$.timestamp")
                                .exists()
                );
    }
}
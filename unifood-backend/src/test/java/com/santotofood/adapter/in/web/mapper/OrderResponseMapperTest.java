package com.santotofood.adapter.in.web.mapper;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.adapter.out.persistence.entity.OrderEntity;
import com.santotofood.adapter.out.persistence.mapper.OrderMapper;
import com.santotofood.domain.model.Order;
import com.santotofood.domain.model.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

/** The client's note reaches the worker response verbatim, or as null when there is none. */
public class OrderResponseMapperTest {
  public static Order order(String note) {
    var entity =
        new OrderEntity(
            UUID.randomUUID(),
            UUID.randomUUID(),
            UUID.randomUUID(),
            "Ana Torres",
            OrderStatus.PENDING,
            new BigDecimal("13000.00"),
            null,
            0,
            null,
            null,
            null,
            null,
            Instant.parse("2026-11-20T14:00:00Z"),
            Instant.parse("2026-11-20T14:00:00Z"));
    entity.setNote(note);
    Order order = new OrderMapper().toDomain(entity);
    order.setItems(List.of());
    return order;
  }

  @ParameterizedTest
  @NullSource
  @ValueSource(
      strings = {
        "Sin cebolla",
        "<script>alert('x')</script> & \"ají\" ñ 🌶",
        "Primera línea\nsegunda línea",
        "Una nota larga de exactamente doscientos caracteres como máximo, que el panel debe"
            + " mostrar entera sin cortar información, porque el cliente la escribió para que la"
            + " cafetería la lea completa sin trucos."
      })
  void theNoteIsCopiedVerbatimOrStaysNull(String note) {
    var response = new OrderResponseMapper().toResponse(order(note));
    assertEquals(note, response.note());
  }

  @ParameterizedTest
  @NullSource
  @ValueSource(strings = {"Sin cebolla", "Línea 1\nLínea 2"})
  void thePersistenceMapperRoundTripsTheReadOnlyNote(String note) {
    var mapper = new OrderMapper();
    assertEquals(note, mapper.toEntity(order(note)).getNote());
  }
}

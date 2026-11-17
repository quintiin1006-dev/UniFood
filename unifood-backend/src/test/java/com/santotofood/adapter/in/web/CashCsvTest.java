package com.santotofood.adapter.in.web;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.application.model.CashSession;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CashCsvTest {
  static CashSession closed(String note, long difference) {
    return new CashSession(
        UUID.randomUUID(),
        UUID.randomUUID(),
        "Cafetería \"Central\"",
        CashSession.Shift.LUNCH,
        LocalDate.parse("2026-11-20"),
        7,
        CashSession.Status.CLOSED,
        50_000,
        Instant.parse("2026-11-20T16:00:00Z"),
        "=Ana",
        Instant.parse("2026-11-20T21:30:00Z"),
        "Luis",
        120_000L,
        5_000L,
        10_000L,
        165_000L,
        165_000L + difference,
        difference,
        2000,
        note,
        0,
        false,
        0,
        null,
        null,
        null,
        3);
  }

  @Test
  void writesBomSemicolonsCrlfAndWholePesos() {
    String csv =
        new String(
            CashCsv.render(List.of(closed("Faltaron 2.050 por vueltos", -2_050))),
            StandardCharsets.UTF_8);
    assertTrue(csv.startsWith("﻿Consecutivo;Cafetería;Fecha;Turno;"));
    String[] lines = csv.split("\r\n");
    assertEquals(2, lines.length);
    String row = lines[1];
    assertTrue(row.startsWith("7;\"Cafetería \"\"Central\"\"\";2026-11-20;Almuerzo;Cerrada;"));
    // Opened 11:00 and closed 16:30 in Bogota.
    assertTrue(row.contains(";2026-11-20 11:00;2026-11-20 16:30;"));
    assertTrue(row.contains(";50000;120000;5000;10000;165000;162950;-2050;Faltante;2000;Sí;No;"));
  }

  @Test
  void neutralizesFormulasInTextButNotInAmounts() {
    String csv =
        new String(CashCsv.render(List.of(closed("-cuadre manual", -100))), StandardCharsets.UTF_8);
    assertTrue(csv.contains("\"'-cuadre manual\""));
    assertTrue(csv.contains("\"'=Ana\""));
    assertTrue(csv.contains(";-100;"));
    assertEquals("", CashCsv.text(null));
    assertEquals("\"'@x\"", CashCsv.text("@x"));
  }
}

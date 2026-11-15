package com.santotofood.adapter.in.web;

import com.santotofood.application.model.CashSession;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Cash closures as CSV for Excel in Spanish: UTF-8 with BOM, ";" as separator, CRLF, amounts as
 * plain integers in COP and times in America/Bogota. Text cells that a spreadsheet would read as a
 * formula are prefixed with an apostrophe.
 */
public final class CashCsv {
  private static final DateTimeFormatter TIME =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("America/Bogota"));
  private static final String HEADER =
      String.join(
          ";",
          "Consecutivo",
          "Cafetería",
          "Fecha",
          "Turno",
          "Estado",
          "Apertura",
          "Cierre",
          "Fondo inicial",
          "Ventas en efectivo",
          "Otros ingresos",
          "Egresos",
          "Efectivo esperado",
          "Efectivo contado",
          "Diferencia",
          "Resultado",
          "Tolerancia",
          "Fuera de tolerancia",
          "Cierre con pedidos pendientes",
          "Nota",
          "Abrió",
          "Cerró",
          "Reaperturas",
          "Último motivo de reapertura");

  private CashCsv() {}

  public static byte[] render(List<CashSession> sessions) {
    var out = new StringBuilder("﻿").append(HEADER).append("\r\n");
    for (var s : sessions) {
      String[] cells = {
        String.valueOf(s.sequenceNumber()),
        text(s.cafeteriaName()),
        s.businessDate().toString(),
        s.shift() == CashSession.Shift.BREAKFAST ? "Desayuno" : "Almuerzo",
        switch (s.status()) {
          case OPEN -> "Abierta";
          case CLOSED -> "Cerrada";
          case REOPENED -> "Reabierta";
        },
        time(s.openedAt()),
        time(s.closedAt()),
        String.valueOf(s.openingFloat()),
        number(s.salesCash()),
        number(s.incomeTotal()),
        number(s.expenseTotal()),
        number(s.expectedCash()),
        number(s.countedCash()),
        number(s.difference()),
        s.outcome() == null
            ? ""
            : switch (s.outcome()) {
              case BALANCED -> "Cuadra";
              case SURPLUS -> "Sobrante";
              case SHORTAGE -> "Faltante";
            },
        s.toleranceCop() == null ? "" : String.valueOf(s.toleranceCop()),
        s.outsideTolerance() == null ? "" : (s.outsideTolerance() ? "Sí" : "No"),
        s.forcedClose() == null ? "" : (s.forcedClose() ? "Sí" : "No"),
        text(s.note()),
        text(s.openedByName()),
        text(s.closedByName()),
        String.valueOf(s.reopenCount()),
        text(s.reopenReason())
      };
      out.append(String.join(";", cells)).append("\r\n");
    }
    return out.toString().getBytes(StandardCharsets.UTF_8);
  }

  private static String time(Instant value) {
    return value == null ? "" : TIME.format(value);
  }

  private static String number(Long value) {
    return value == null ? "" : String.valueOf(value);
  }

  /** Quoted text; "=", "+", "-", "@", tab and CR at the start never run as a formula. */
  static String text(String value) {
    if (value == null || value.isEmpty()) return "";
    String safe = "=+-@\t\r".indexOf(value.charAt(0)) >= 0 ? "'" + value : value;
    return "\"" + safe.replace("\"", "\"\"") + "\"";
  }
}

package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.ServiceFeeAuditEntry;
import com.santotofood.application.model.ServiceFeeMonth;
import com.santotofood.application.model.ServiceFeeOverview;
import com.santotofood.application.model.ServiceFeeStatement;
import com.santotofood.application.service.ServiceFeeRules;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** JSON of the service fee endpoints (033). Fees are whole pesos; product sales decimal strings. */
public final class ServiceFeeResponses {
  private ServiceFeeResponses() {}

  public record Overview(
      General general, List<Cafeteria> cafeterias, int maxFeeCop, int graceDays) {}

  public record General(int feeCop, int version, Instant updatedAt) {}

  /** {@code ownFeeCop} null: the cafeteria uses the general fee. */
  public record Cafeteria(
      UUID id,
      String name,
      String siteName,
      boolean visible,
      Integer ownFeeCop,
      int effectiveFeeCop,
      int version) {}

  /** {@code pendingFee}: what is still owed to UniFood for this month (not PAGADA). */
  public record Month(String month, boolean current, List<Row> rows, Totals totals) {}

  public record Totals(int deliveredOrders, String productsTotal, long feeTotal, long pendingFee) {}

  public record Row(
      UUID cafeteriaId,
      String cafeteriaName,
      String siteName,
      String month,
      int deliveredOrders,
      String productsTotal,
      long feeTotal,
      String status,
      Instant closedAt,
      Instant paidAt,
      String note,
      boolean overdue,
      long daysOverdue,
      boolean closable) {}

  public record Statement(
      UUID cafeteriaId, String cafeteriaName, int currentFeeCop, List<Row> months) {}

  public record Audit(List<AuditEntry> entries) {}

  public record AuditEntry(
      String action,
      UUID cafeteriaId,
      String cafeteriaName,
      LocalDate periodMonth,
      Map<String, Object> oldValue,
      Map<String, Object> newValue,
      Instant changedAt,
      String source,
      String changedByName) {}

  public static Overview overview(ServiceFeeOverview overview) {
    var general = overview.general();
    return new Overview(
        new General(general.feeCop(), general.version(), general.updatedAt()),
        overview.cafeterias().stream()
            .map(
                c ->
                    new Cafeteria(
                        c.id(),
                        c.name(),
                        c.siteName(),
                        c.visible(),
                        c.ownFeeCop(),
                        c.effectiveFeeCop(),
                        c.version()))
            .toList(),
        ServiceFeeRules.MAX_FEE_COP,
        ServiceFeeRules.SETTLEMENT_GRACE_DAYS);
  }

  public static Month month(ServiceFeeMonth month) {
    var rows = month.rows().stream().map(ServiceFeeResponses::row).toList();
    int orders = 0;
    var products = BigDecimal.ZERO;
    long fees = 0;
    long pending = 0;
    for (var row : month.rows()) {
      orders += row.deliveredOrders();
      products = products.add(row.productsTotal());
      fees += row.feeTotal();
      if (row.status() != ServiceFeeMonth.Status.PAGADA) pending += row.feeTotal();
    }
    return new Month(
        month.month().toString(),
        month.current(),
        rows,
        new Totals(orders, money(products), fees, pending));
  }

  public static Row row(ServiceFeeMonth.Row row) {
    return new Row(
        row.cafeteriaId(),
        row.cafeteriaName(),
        row.siteName(),
        row.month().toString(),
        row.deliveredOrders(),
        money(row.productsTotal()),
        row.feeTotal(),
        row.status().name(),
        row.closedAt(),
        row.paidAt(),
        row.note(),
        row.overdue(),
        row.daysOverdue(),
        row.closable());
  }

  public static Statement statement(ServiceFeeStatement statement) {
    return new Statement(
        statement.cafeteriaId(),
        statement.cafeteriaName(),
        statement.currentFeeCop(),
        statement.months().stream().map(ServiceFeeResponses::row).toList());
  }

  public static Audit audit(List<ServiceFeeAuditEntry> entries) {
    return new Audit(
        entries.stream()
            .map(
                e ->
                    new AuditEntry(
                        e.action(),
                        e.cafeteriaId(),
                        e.cafeteriaName(),
                        e.periodMonth(),
                        e.oldValue(),
                        e.newValue(),
                        e.changedAt(),
                        e.source(),
                        e.changedByName()))
            .toList());
  }

  /** The month as CSV (rule 10): a header and one line per cafeteria, UTF-8, comma separated. */
  public static String csv(ServiceFeeMonth month) {
    var out =
        new StringBuilder(
            "cafeteria,sede,mes,pedidos_entregados,ventas_productos_cop,cargo_por_servicio_cop,"
                + "estado,vencido,dias_atraso,cerrado_en,pagado_en,nota\r\n");
    for (var row : month.rows())
      out.append(cell(row.cafeteriaName()))
          .append(',')
          .append(cell(row.siteName()))
          .append(',')
          .append(row.month())
          .append(',')
          .append(row.deliveredOrders())
          .append(',')
          .append(money(row.productsTotal()))
          .append(',')
          .append(row.feeTotal())
          .append(',')
          .append(row.status().name())
          .append(',')
          .append(row.overdue() ? "SI" : "NO")
          .append(',')
          .append(row.daysOverdue())
          .append(',')
          .append(row.closedAt() == null ? "" : row.closedAt().toString())
          .append(',')
          .append(row.paidAt() == null ? "" : row.paidAt().toString())
          .append(',')
          .append(cell(row.note()))
          .append("\r\n");
    return out.toString();
  }

  /**
   * Quoted, with quotes doubled; a cell that starts like a formula is prefixed with ' so a
   * spreadsheet shows it as text (CSV injection).
   */
  static String cell(String value) {
    if (value == null) return "";
    var text = value.replace("\r", " ").replace("\n", " ");
    if (!text.isEmpty() && "=+-@\t".indexOf(text.charAt(0)) >= 0) text = "'" + text;
    return '"' + text.replace("\"", "\"\"") + '"';
  }

  static String money(BigDecimal value) {
    return value.setScale(2, RoundingMode.HALF_UP).toPlainString();
  }
}

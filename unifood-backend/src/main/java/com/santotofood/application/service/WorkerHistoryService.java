package com.santotofood.application.service;

import com.santotofood.application.model.WorkerHistory;
import com.santotofood.application.model.WorkerHistoryCursor;
import com.santotofood.application.model.WorkerHistoryRequest;
import com.santotofood.application.port.in.GetWorkerHistoryUseCase;
import com.santotofood.application.port.out.WorkerHistoryQueryPort;
import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.port.out.TimeProvider;
import java.time.DayOfWeek;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkerHistoryService implements GetWorkerHistoryUseCase {
  private static final Map<String, String> LABELS =
      Map.of("DELIVERED", "Entregado", "NOT_COLLECTED", "No recogido", "CANCELLED", "Cancelado");
  private final WorkerHistoryQueryPort history;
  private final TimeProvider time;

  public WorkerHistoryService(WorkerHistoryQueryPort history, TimeProvider time) {
    this.history = history;
    this.time = time;
  }

  @Override
  @Transactional(readOnly = true, timeout = 15)
  public WorkerHistory getHistory(UUID authorizedCafeteriaId, WorkerHistoryRequest request) {
    Objects.requireNonNull(authorizedCafeteriaId);
    Objects.requireNonNull(request);
    // One clock reading fixes the date, month, cursor scope and query boundaries.
    BusinessDate date = BusinessDate.from(time.now());
    var month = date.value().withDayOfMonth(1);
    var from =
        switch (request.range()) {
          case TODAY -> date.value();
          case WEEK -> date.value().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
          case MONTH -> month;
        };
    if (from.isBefore(month)) from = month;
    var start = new BusinessDate(from).dayStartInstant();
    var end = date.nextDayStartInstant();
    String scope = WorkerHistoryCursor.scope(authorizedCafeteriaId, month, request);
    var cursor = WorkerHistoryCursor.decode(request.cursor(), scope, start, end);
    List<String> states =
        request.query().isEmpty()
            ? List.of()
            : LABELS.entrySet().stream()
                .filter(
                    e ->
                        WorkerHistoryRequest.normalize(e.getKey()).contains(request.query())
                            || WorkerHistoryRequest.normalize(e.getValue())
                                .contains(request.query()))
                .map(Map.Entry::getKey)
                .toList();
    var result =
        history.findCompleted(
            new WorkerHistoryQueryPort.Query(
                authorizedCafeteriaId,
                start,
                end,
                new BusinessDate(month).dayStartInstant(),
                request.query(),
                states,
                request.status(),
                cursor,
                request.limit() + 1));
    var entries = result.orders().stream().limit(request.limit()).toList();
    String next = null;
    if (result.orders().size() > request.limit()) {
      var last = entries.getLast();
      next = new WorkerHistoryCursor(last.completedAt(), last.id()).encode(scope);
    }
    return new WorkerHistory(
        date, end, month, from, date.value().plusDays(1), entries, next, result.hasHistory());
  }
}

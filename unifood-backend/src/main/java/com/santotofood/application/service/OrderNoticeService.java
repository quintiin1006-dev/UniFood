package com.santotofood.application.service;

import com.santotofood.application.exception.OrderNoticeException;
import com.santotofood.application.model.OrderNotice;
import com.santotofood.application.model.OrderNoticeKind;
import com.santotofood.application.port.in.GetOrderNoticesUseCase;
import com.santotofood.application.port.in.MarkOrderNoticesReadUseCase;
import com.santotofood.application.port.out.OrderNoticePort;
import com.santotofood.application.port.out.OrderNoticesFlag;
import com.santotofood.domain.port.out.TimeProvider;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The bell inbox. The user always comes from the authenticated identity and the client role from
 * the database; the port filters every read and write by that user. With AVISOS_BANDEJA_ENABLED off
 * nothing is written and both endpoints answer 404.
 */
@Service
public class OrderNoticeService
    implements GetOrderNoticesUseCase, MarkOrderNoticesReadUseCase, OrderNoticeRecorder {
  private static final Logger LOG = LoggerFactory.getLogger(OrderNoticeService.class);

  public static final int MAX_NOTICES = 20;
  public static final Duration WINDOW = Duration.ofDays(7);

  private final OrderNoticesFlag flag;
  private final OrderAuthorizationService authorization;
  private final OrderNoticePort notices;
  private final TimeProvider clock;

  public OrderNoticeService(
      OrderNoticesFlag flag,
      OrderAuthorizationService authorization,
      OrderNoticePort notices,
      TimeProvider clock) {
    this.flag = flag;
    this.authorization = authorization;
    this.notices = notices;
    this.clock = clock;
  }

  @Override
  public void record(UUID orderId, OrderNoticeKind kind, int sequence, Instant at) {
    try {
      if (!flag.enabled() || orderId == null || kind == null) return;
      notices.record(orderId, kind, sequence, at == null ? clock.now() : at);
    } catch (RuntimeException failure) {
      // The order transition must never depend on the inbox.
      LOG.warn("Order notice {} not stored ({})", kind, failure.getClass().getSimpleName());
    }
  }

  @Override
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 15)
  public List<OrderNotice> recentNotices(UUID authenticatedUserId) {
    requireClient(authenticatedUserId);
    return notices.findRecent(authenticatedUserId, clock.now().minus(WINDOW), MAX_NOTICES);
  }

  @Override
  @Transactional(timeout = 15)
  public void markNoticesRead(UUID authenticatedUserId) {
    requireClient(authenticatedUserId);
    notices.markRead(authenticatedUserId, clock.now());
  }

  private void requireClient(UUID authenticatedUserId) {
    Objects.requireNonNull(authenticatedUserId);
    if (!flag.enabled()) throw OrderNoticeException.disabled();
    if (!authorization.client(authenticatedUserId)) throw OrderNoticeException.forbidden();
  }
}

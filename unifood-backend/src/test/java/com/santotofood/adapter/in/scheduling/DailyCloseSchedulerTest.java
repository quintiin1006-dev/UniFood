package com.santotofood.adapter.in.scheduling;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.santotofood.application.port.in.CloseStaleOrdersUseCase;
import java.lang.reflect.Method;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.scheduling.annotation.Scheduled;

class DailyCloseSchedulerTest {
  final ApplicationContextRunner runner =
      new ApplicationContextRunner()
          .withBean(CloseStaleOrdersUseCase.class, () -> mock(CloseStaleOrdersUseCase.class))
          .withUserConfiguration(DailyCloseScheduler.class);

  @Test
  void itIsOnByDefaultAndTheSwitchRemovesIt() {
    runner.run(context -> assertThat(context).hasSingleBean(DailyCloseScheduler.class));
    runner
        .withPropertyValues("orders.daily-close.enabled=true")
        .run(context -> assertThat(context).hasSingleBean(DailyCloseScheduler.class));
    runner
        .withPropertyValues("orders.daily-close.enabled=false")
        .run(context -> assertThat(context).doesNotHaveBean(DailyCloseScheduler.class));
  }

  @Test
  void itRunsAtStartupAndThenEveryConfiguredIntervalOfOneHourByDefault() throws Exception {
    Method run = DailyCloseScheduler.class.getMethod("run");
    Scheduled scheduled = run.getAnnotation(Scheduled.class);
    assertEquals(Duration.ZERO, Duration.parse(scheduled.initialDelayString()));
    assertEquals("${orders.daily-close.interval:PT1H}", scheduled.fixedDelayString());
    assertEquals(Duration.ofHours(1), Duration.parse("PT1H"));
  }

  @Test
  void springRunsItAtStartupAndAgainAfterTheConfiguredIntervalEvenAfterAFailure() {
    var close = mock(CloseStaleOrdersUseCase.class);
    when(close.closeStaleOrders())
        .thenThrow(new QueryTimeoutException("first run fails"))
        .thenReturn(new CloseStaleOrdersUseCase.ClosedOrders(0, 0));
    new ApplicationContextRunner()
        .withBean(CloseStaleOrdersUseCase.class, () -> close)
        .withUserConfiguration(
            com.santotofood.config.SchedulingConfig.class, DailyCloseScheduler.class)
        .withPropertyValues("orders.daily-close.interval=PT0.2S")
        .run(context -> verify(close, timeout(5000).atLeast(3)).closeStaleOrders());
  }

  @Test
  void withTheSwitchOffSpringNeverRunsIt() throws Exception {
    var close = mock(CloseStaleOrdersUseCase.class);
    new ApplicationContextRunner()
        .withBean(CloseStaleOrdersUseCase.class, () -> close)
        .withUserConfiguration(
            com.santotofood.config.SchedulingConfig.class, DailyCloseScheduler.class)
        .withPropertyValues(
            "orders.daily-close.enabled=false", "orders.daily-close.interval=PT0.1S")
        .run(
            context -> {
              Thread.sleep(500);
              verifyNoInteractions(close);
            });
  }

  @Test
  void aFailedRunIsLoggedAndLeftForTheNextOne() {
    var close = mock(CloseStaleOrdersUseCase.class);
    when(close.closeStaleOrders()).thenThrow(new QueryTimeoutException("PRIVATE SQL DETAIL"));
    assertDoesNotThrow(() -> new DailyCloseScheduler(close).run());
    verify(close).closeStaleOrders();
  }

  @Test
  void aFailedRunWarnsWithTheExceptionTypeAndHowManyOrdersAreLeftOpen() {
    var close = mock(CloseStaleOrdersUseCase.class);
    when(close.closeStaleOrders()).thenThrow(new QueryTimeoutException("Ana Torres 1234567"));
    when(close.countStaleOrders()).thenReturn(4);
    var warnings = capture(() -> new DailyCloseScheduler(close).run());
    assertEquals(1, warnings.size());
    assertEquals(Level.WARN, warnings.get(0).getLevel());
    assertEquals(
        "Cierre diario no completado: QueryTimeoutException; 4 pedidos sin cerrar",
        warnings.get(0).getFormattedMessage());
    // Never the exception's text nor any client data.
    assertFalse(warnings.get(0).getFormattedMessage().contains("Ana"));
    assertNull(warnings.get(0).getThrowableProxy());
  }

  @Test
  void whenTheCountAlsoFailsTheWarningSaysSoWithoutDetails() {
    var close = mock(CloseStaleOrdersUseCase.class);
    when(close.closeStaleOrders()).thenThrow(new QueryTimeoutException("down"));
    when(close.countStaleOrders()).thenThrow(new QueryTimeoutException("still down"));
    var warnings = capture(() -> assertDoesNotThrow(() -> new DailyCloseScheduler(close).run()));
    assertEquals(1, warnings.size());
    assertEquals(
        "Cierre diario no completado: QueryTimeoutException; no se pudo contar lo pendiente",
        warnings.get(0).getFormattedMessage());
  }

  @Test
  void aSuccessfulRunNeitherCountsNorWarns() {
    var close = mock(CloseStaleOrdersUseCase.class);
    when(close.closeStaleOrders()).thenReturn(new CloseStaleOrdersUseCase.ClosedOrders(1, 2));
    assertTrue(capture(() -> new DailyCloseScheduler(close).run()).isEmpty());
    verify(close, never()).countStaleOrders();
  }

  private static java.util.List<ILoggingEvent> capture(Runnable action) {
    var logger = (Logger) LoggerFactory.getLogger(DailyCloseScheduler.class);
    var appender = new ListAppender<ILoggingEvent>();
    appender.start();
    logger.addAppender(appender);
    try {
      action.run();
    } finally {
      logger.detachAppender(appender);
    }
    return appender.list.stream().filter(event -> event.getLevel() == Level.WARN).toList();
  }
}

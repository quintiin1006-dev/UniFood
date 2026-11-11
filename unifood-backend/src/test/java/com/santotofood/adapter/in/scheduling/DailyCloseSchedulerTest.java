package com.santotofood.adapter.in.scheduling;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.port.in.CloseStaleOrdersUseCase;
import java.lang.reflect.Method;
import java.time.Duration;
import org.junit.jupiter.api.Test;
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
}

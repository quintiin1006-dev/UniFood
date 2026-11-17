package com.santotofood.adapter.out.push;

import static org.junit.jupiter.api.Assertions.*;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.santotofood.application.model.PushRecipient;
import com.santotofood.application.model.PushSubscriberRole;
import com.santotofood.application.model.PushSubscriptionRegistration;
import com.santotofood.application.port.out.PushSubscriptionPort;
import com.santotofood.domain.model.OrderPushEvent;
import com.santotofood.domain.model.OrderPushEvent.Kind;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** The dispatcher against a simulated push service: success, 410, timeout and failure. */
class PushNotificationDispatcherTest {
  static final String ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-secret-path";
  final AtomicReference<Instant> clock =
      new AtomicReference<>(Instant.parse("2026-11-20T17:00:00Z"));
  final FakeSubscriptions subscriptions = new FakeSubscriptions();
  final ScriptedSender sender = new ScriptedSender();
  final List<Duration> sleeps = new ArrayList<>();

  PushNotificationDispatcher dispatcher(PushSettings settings) {
    return new PushNotificationDispatcher(
        subscriptions, List.of(sender), Runnable::run, settings, clock::get, sleeps::add);
  }

  PushNotificationDispatcher dispatcher() {
    return dispatcher(PushSettings.defaults());
  }

  PushRecipient recipient(UUID user) {
    var recipient =
        new PushRecipient(UUID.randomUUID(), user, "WEB_PUSH", ENDPOINT, "p256dh", "auth");
    subscriptions.recipients.add(recipient);
    return recipient;
  }

  @AfterEach
  void clearSynchronization() {
    if (TransactionSynchronizationManager.isSynchronizationActive())
      TransactionSynchronizationManager.clearSynchronization();
  }

  @Test
  void aDeliveredNoticeIsSentOnceWithTheOrderPayload() {
    recipient(UUID.randomUUID());
    sender.results.add(PushChannelSender.Result.DELIVERED);
    var order = UUID.fromString("a41b2c3d-0000-4000-8000-000000000001");
    dispatcher().publish(OrderPushEvent.of(order, Kind.READY));
    assertEquals(1, sender.sent.size());
    var message = sender.sent.getFirst();
    assertEquals("¡Tu pedido está listo!", message.title());
    assertEquals("unifood-order-A41B2C3D", message.tag());
    assertEquals("/cuenta/pedido", message.url());
    assertTrue(message.urgent());
    assertEquals(OrderPushEvent.Audience.CLIENT, subscriptions.audiences.getFirst());
    assertTrue(subscriptions.gone.isEmpty());
  }

  @Test
  void aNewOrderGoesToTheWorkersWithTheEightCharacterReference() {
    recipient(UUID.randomUUID());
    sender.results.add(PushChannelSender.Result.DELIVERED);
    var order = UUID.fromString("a41b2c3d-0000-4000-8000-000000000002");
    dispatcher().publish(OrderPushEvent.of(order, Kind.NEW_ORDER));
    assertEquals(OrderPushEvent.Audience.WORKERS, subscriptions.audiences.getFirst());
    assertEquals("Nuevo pedido #A41B2C3D", sender.sent.getFirst().title());
    assertEquals("/worker", sender.sent.getFirst().url());
  }

  @Test
  void a410RevokesTheSubscriptionWithoutRetrying() {
    var recipient = recipient(UUID.randomUUID());
    sender.results.add(PushChannelSender.Result.GONE);
    dispatcher().publish(OrderPushEvent.of(UUID.randomUUID(), Kind.CALLED));
    assertEquals(List.of(recipient.subscriptionId()), subscriptions.gone);
    assertEquals(1, sender.sent.size());
  }

  @Test
  void aTimeoutRetriesALimitedNumberOfTimesWithBackoff() {
    recipient(UUID.randomUUID());
    for (int i = 0; i < 5; i++) sender.results.add(PushChannelSender.Result.RETRYABLE);
    dispatcher().publish(OrderPushEvent.of(UUID.randomUUID(), Kind.PREPARING));
    assertEquals(3, sender.sent.size(), "one attempt and two retries");
    assertEquals(List.of(Duration.ofSeconds(1), Duration.ofSeconds(2)), sleeps);
    assertTrue(subscriptions.gone.isEmpty());
  }

  @Test
  void aRetryThatSucceedsStopsRetrying() {
    recipient(UUID.randomUUID());
    sender.results.add(PushChannelSender.Result.RETRYABLE);
    sender.results.add(PushChannelSender.Result.DELIVERED);
    dispatcher().publish(OrderPushEvent.of(UUID.randomUUID(), Kind.PREPARING));
    assertEquals(2, sender.sent.size());
  }

  @Test
  void aRefusalOrASenderExceptionNeverRetriesNorEscapes() {
    recipient(UUID.randomUUID());
    recipient(UUID.randomUUID());
    sender.results.add(PushChannelSender.Result.REJECTED);
    sender.throwNext = true;
    assertDoesNotThrow(
        () -> dispatcher().publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY)));
    assertEquals(2, sender.attempts);
    assertTrue(subscriptions.gone.isEmpty());
  }

  @Test
  void aRefusalLogsTheHttpStatusButNeverTheEndpointKeysOrBody() {
    var appender = new ListAppender<ILoggingEvent>();
    appender.start();
    var logger = (Logger) LoggerFactory.getLogger(PushNotificationDispatcher.class);
    logger.addAppender(appender);
    try {
      recipient(UUID.randomUUID());
      sender.results.add(PushChannelSender.Result.REJECTED);
      sender.statuses.add(403);
      dispatcher().publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
      var warning =
          appender.list.stream()
              .map(ILoggingEvent::getFormattedMessage)
              .filter(text -> text.contains("refused"))
              .findFirst()
              .orElseThrow();
      assertTrue(warning.contains("refused (HTTP 403)"), warning);
      assertFalse(warning.contains(ENDPOINT), warning);
      for (String secret : List.of("p256dh", "auth", "¡Tu pedido está listo!"))
        assertFalse(warning.contains(secret), warning);
      assertEquals(1, sender.attempts, "a refusal is still never retried");
      assertTrue(subscriptions.gone.isEmpty(), "and never revoked");
    } finally {
      logger.detachAppender(appender);
    }
  }

  @Test
  void aRefusalWithoutAnHttpResponseSaysSo() {
    assertEquals("HTTP 403", PushNotificationDispatcher.refusal(403));
    assertEquals("no HTTP response", PushNotificationDispatcher.refusal(null));
  }

  @Test
  void aDatabaseFailureResolvingRecipientsNeverEscapes() {
    subscriptions.failLookup = true;
    assertDoesNotThrow(
        () -> dispatcher().publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY)));
    assertEquals(0, sender.attempts);
  }

  @Test
  void theSameTransitionOfTheSameOrderIsSentOnlyOnce() {
    recipient(UUID.randomUUID());
    var dispatcher = dispatcher();
    var order = UUID.randomUUID();
    dispatcher.publish(OrderPushEvent.of(order, Kind.CALLED));
    dispatcher.publish(OrderPushEvent.of(order, Kind.CALLED));
    assertEquals(1, sender.attempts);
    // A different reminder number is a different notice.
    dispatcher.publish(new OrderPushEvent(order, Kind.REMINDER, 1));
    dispatcher.publish(new OrderPushEvent(order, Kind.REMINDER, 2));
    dispatcher.publish(new OrderPushEvent(order, Kind.REMINDER, 2));
    assertEquals(3, sender.attempts);
  }

  @Test
  void eachUserHasALimitOfNoticesPerWindow() {
    var user = UUID.randomUUID();
    recipient(user);
    var dispatcher = dispatcher();
    for (int i = 0; i < 25; i++)
      dispatcher.publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
    assertEquals(20, sender.attempts);
    clock.set(clock.get().plus(Duration.ofMinutes(11)));
    dispatcher.publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
    assertEquals(21, sender.attempts);
  }

  @Test
  void insideATransactionNothingIsSentUntilItCommits() {
    recipient(UUID.randomUUID());
    TransactionSynchronizationManager.initSynchronization();
    dispatcher().publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
    assertEquals(0, sender.attempts, "nothing before the commit");
    for (TransactionSynchronization sync : TransactionSynchronizationManager.getSynchronizations())
      sync.afterCommit();
    assertEquals(1, sender.attempts);
  }

  @Test
  void aRolledBackTransactionSendsNothing() {
    recipient(UUID.randomUUID());
    TransactionSynchronizationManager.initSynchronization();
    dispatcher().publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
    for (TransactionSynchronization sync : TransactionSynchronizationManager.getSynchronizations())
      sync.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
    assertEquals(0, sender.attempts);
  }

  @Test
  void aFullQueueDropsTheNoticeWithoutFailingTheCaller() {
    recipient(UUID.randomUUID());
    var dispatcher =
        new PushNotificationDispatcher(
            subscriptions,
            List.of(sender),
            task -> {
              throw new RejectedExecutionException("full");
            },
            PushSettings.defaults(),
            clock::get,
            sleeps::add);
    assertDoesNotThrow(() -> dispatcher.publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY)));
    assertEquals(0, sender.attempts);
  }

  @Test
  void withoutSendersTheModuleIsDisabledAndDoesNothing() {
    recipient(UUID.randomUUID());
    var disabled =
        new PushNotificationDispatcher(
            subscriptions,
            List.of(),
            Runnable::run,
            PushSettings.defaults(),
            clock::get,
            sleeps::add);
    disabled.publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
    assertTrue(subscriptions.audiences.isEmpty(), "not even a database lookup");
  }

  @Test
  void aChannelWithoutSenderIsSkipped() {
    subscriptions.recipients.add(
        new PushRecipient(UUID.randomUUID(), UUID.randomUUID(), "FCM", "token", null, null));
    dispatcher().publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
    assertEquals(0, sender.attempts);
  }

  @Test
  void theClientsOwnCancellationAndTerminalStatesHaveNoEvent() {
    for (var status : com.santotofood.domain.model.OrderStatus.values()) {
      var order =
          com.santotofood.domain.model.Order.reconstitute(
              UUID.randomUUID(),
              UUID.randomUUID(),
              UUID.randomUUID(),
              "Ana",
              "1",
              "STUDENT",
              status,
              java.math.BigDecimal.TEN,
              Instant.EPOCH,
              Instant.EPOCH);
      var event = OrderPushEvent.forStatus(order);
      switch (status) {
        case PREPARING, READY, CALLED, NOT_COLLECTED ->
            assertTrue(event.isPresent(), status.name());
        default -> assertTrue(event.isEmpty(), status.name());
      }
    }
  }

  static final class ScriptedSender implements PushChannelSender {
    final Deque<Result> results = new ConcurrentLinkedDeque<>();
    final Deque<Integer> statuses = new ConcurrentLinkedDeque<>();
    final List<PushMessage> sent = new ArrayList<>();
    int attempts;
    boolean throwNext;

    @Override
    public String channel() {
      return "WEB_PUSH";
    }

    @Override
    public Result send(PushRecipient recipient, PushMessage message) {
      attempts++;
      if (throwNext) {
        throwNext = false;
        throw new IllegalStateException("simulated failure");
      }
      sent.add(message);
      var next = results.pollFirst();
      return next == null ? Result.DELIVERED : next;
    }

    @Override
    public Delivery deliver(PushRecipient recipient, PushMessage message) {
      return new Delivery(send(recipient, message), statuses.pollFirst());
    }
  }

  static final class FakeSubscriptions implements PushSubscriptionPort {
    final List<PushRecipient> recipients = new ArrayList<>();
    final List<OrderPushEvent.Audience> audiences = new ArrayList<>();
    final List<UUID> gone = new ArrayList<>();
    boolean failLookup;

    @Override
    public UUID upsert(
        UUID userId,
        PushSubscriberRole role,
        UUID cafeteriaId,
        PushSubscriptionRegistration registration,
        int maxDevices) {
      throw new UnsupportedOperationException();
    }

    @Override
    public boolean revokeOwnEndpoint(UUID userId, String endpoint) {
      throw new UnsupportedOperationException();
    }

    @Override
    public boolean revokeOwnSubscription(UUID userId, UUID subscriptionId) {
      throw new UnsupportedOperationException();
    }

    @Override
    public List<PushRecipient> findRecipients(UUID orderId, OrderPushEvent.Audience audience) {
      audiences.add(audience);
      if (failLookup) throw new org.springframework.dao.QueryTimeoutException("simulated");
      return recipients;
    }

    @Override
    public void markGone(UUID subscriptionId) {
      gone.add(subscriptionId);
    }
  }
}

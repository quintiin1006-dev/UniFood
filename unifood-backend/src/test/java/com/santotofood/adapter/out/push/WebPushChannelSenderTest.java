package com.santotofood.adapter.out.push;

import static org.junit.jupiter.api.Assertions.*;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.santotofood.adapter.out.push.PushChannelSender.Result;
import com.santotofood.application.model.PushRecipient;
import com.santotofood.domain.model.OrderPushEvent;
import com.santotofood.domain.model.OrderPushEvent.Kind;
import java.io.IOException;
import java.net.http.HttpRequest;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.slf4j.LoggerFactory;

/** Real aes128gcm encryption and VAPID signing against a simulated push service. */
class WebPushChannelSenderTest {
  static final String ENDPOINT =
      "https://fcm.googleapis.com/fcm/send/super-secret-device-capability-0123456789";
  final PushTestKeys server = PushTestKeys.generate();
  final PushTestKeys browser = PushTestKeys.generate();
  final PushRecipient recipient =
      new PushRecipient(
          UUID.randomUUID(),
          UUID.randomUUID(),
          "WEB_PUSH",
          ENDPOINT,
          browser.publicKey,
          PushTestKeys.authSecret());
  final List<ILoggingEvent> logs = new ArrayList<>();
  final ListAppender<ILoggingEvent> appender = new ListAppender<>();

  VapidKeys keys() {
    return VapidKeys.load(server.publicKey, server.privateKey, "mailto:soporte@example.invalid")
        .keys()
        .orElseThrow();
  }

  @BeforeEach
  void captureLogs() {
    appender.list = logs;
    appender.start();
    ((Logger) LoggerFactory.getLogger("com.santotofood")).addAppender(appender);
  }

  @AfterEach
  void releaseLogs() {
    ((Logger) LoggerFactory.getLogger("com.santotofood")).detachAppender(appender);
  }

  @Test
  void anUrgentNoticeCarriesShortTtlHighUrgencyTopicAndVapid() {
    var captured = new AtomicReference<HttpRequest>();
    var sender =
        new WebPushChannelSender(
            keys(),
            PushSettings.defaults(),
            request -> {
              captured.set(request);
              return 201;
            });
    var message = PushMessage.of(OrderPushEvent.of(UUID.randomUUID(), Kind.CALLED));
    assertEquals(Result.DELIVERED, sender.send(recipient, message));
    var request = captured.get();
    assertEquals("POST", request.method());
    assertEquals(ENDPOINT, request.uri().toString());
    assertEquals("900", request.headers().firstValue("TTL").orElseThrow());
    assertEquals("high", request.headers().firstValue("Urgency").orElseThrow());
    assertEquals(message.topic(), request.headers().firstValue("Topic").orElseThrow());
    assertEquals("aes128gcm", request.headers().firstValue("Content-Encoding").orElseThrow());
    assertTrue(request.headers().firstValue("Authorization").orElseThrow().startsWith("vapid t="));
    assertTrue(request.timeout().isPresent());
  }

  @Test
  void aRegularNoticeUsesTheDefaultTtlAndUrgency() {
    var captured = new AtomicReference<HttpRequest>();
    var sender =
        new WebPushChannelSender(
            keys(),
            PushSettings.defaults(),
            request -> {
              captured.set(request);
              return 201;
            });
    sender.send(recipient, PushMessage.of(OrderPushEvent.of(UUID.randomUUID(), Kind.PREPARING)));
    assertEquals("3600", captured.get().headers().firstValue("TTL").orElseThrow());
    assertEquals("normal", captured.get().headers().firstValue("Urgency").orElseThrow());
  }

  @Test
  void ttlAndUrgencyComeFromTheSettings() {
    var settings =
        new PushSettings(
            Duration.ofMinutes(30),
            Duration.ofHours(2),
            "normal",
            "low",
            Duration.ofSeconds(5),
            Duration.ofSeconds(10),
            2,
            Duration.ZERO,
            20,
            Duration.ofMinutes(10));
    var captured = new AtomicReference<HttpRequest>();
    new WebPushChannelSender(
            keys(),
            settings,
            request -> {
              captured.set(request);
              return 201;
            })
        .send(recipient, PushMessage.of(OrderPushEvent.of(UUID.randomUUID(), Kind.READY)));
    assertEquals("1800", captured.get().headers().firstValue("TTL").orElseThrow());
    assertEquals("normal", captured.get().headers().firstValue("Urgency").orElseThrow());
  }

  @ParameterizedTest
  @CsvSource({
    "200,DELIVERED",
    "201,DELIVERED",
    "202,DELIVERED",
    "404,GONE",
    "410,GONE",
    "429,RETRYABLE",
    "500,RETRYABLE",
    "503,RETRYABLE",
    "400,REJECTED",
    "401,REJECTED",
    "403,REJECTED",
    "413,REJECTED",
    "301,REJECTED"
  })
  void theStatusOfThePushServiceDecidesTheOutcome(int status, Result expected) {
    var sender = new WebPushChannelSender(keys(), PushSettings.defaults(), request -> status);
    assertEquals(expected, sender.send(recipient, message()));
    // The dispatcher's log needs the status itself, not only the outcome.
    assertEquals(
        new PushChannelSender.Delivery(expected, status), sender.deliver(recipient, message()));
  }

  @Test
  void aTimeoutOrNetworkErrorIsRetryable() {
    var timeout =
        new WebPushChannelSender(
            keys(),
            PushSettings.defaults(),
            request -> {
              throw new HttpTimeoutException("timed out");
            });
    assertEquals(Result.RETRYABLE, timeout.send(recipient, message()));
    var network =
        new WebPushChannelSender(
            keys(),
            PushSettings.defaults(),
            request -> {
              throw new IOException("connection reset");
            });
    assertEquals(Result.RETRYABLE, network.send(recipient, message()));
    assertNull(network.deliver(recipient, message()).httpStatus(), "no response, no status");
  }

  @Test
  void anEndpointOutsideThePushServicesIsNeverContacted() {
    var called = new AtomicReference<Boolean>(false);
    var sender =
        new WebPushChannelSender(
            keys(),
            PushSettings.defaults(),
            request -> {
              called.set(true);
              return 201;
            });
    for (String endpoint :
        List.of(
            "http://fcm.googleapis.com/fcm/send/x",
            "https://169.254.169.254/latest/meta-data",
            "https://localhost/push",
            "https://fcm.googleapis.com.evil.example/x",
            "https://user@fcm.googleapis.com/x",
            "https://fcm.googleapis.com:8443/x")) {
      var foreign =
          new PushRecipient(
              UUID.randomUUID(),
              UUID.randomUUID(),
              "WEB_PUSH",
              endpoint,
              browser.publicKey,
              PushTestKeys.authSecret());
      assertEquals(Result.REJECTED, sender.send(foreign, message()), endpoint);
    }
    assertFalse(called.get());
  }

  @Test
  void brokenStoredKeysAreRejectedAndLoggedWithoutTheEndpointPath() {
    var broken =
        new PushRecipient(
            UUID.randomUUID(), UUID.randomUUID(), "WEB_PUSH", ENDPOINT, "not-a-key", "short");
    var sender = new WebPushChannelSender(keys(), PushSettings.defaults(), request -> 201);
    assertEquals(Result.REJECTED, sender.send(broken, message()));
    assertNoSecretsInLogs();
    assertFalse(logs.isEmpty(), "the failure is logged");
  }

  @Test
  void theDispatcherNeverLogsTheEndpointNorTheVapidPrivateKey() {
    var keys = keys();
    var outcomes = new java.util.ArrayDeque<>(List.of(410, 500, 500, 500, 400));
    var sender =
        new WebPushChannelSender(
            keys,
            PushSettings.defaults(),
            request -> {
              Integer next = outcomes.pollFirst();
              if (next == null) throw new HttpTimeoutException("timed out");
              return next;
            });
    var subscriptions = new PushNotificationDispatcherTest.FakeSubscriptions();
    subscriptions.recipients.add(recipient);
    var dispatcher =
        new PushNotificationDispatcher(
            subscriptions,
            List.of(sender),
            Runnable::run,
            PushSettings.defaults(),
            () -> Instant.parse("2026-11-20T17:00:00Z"),
            duration -> {});
    for (int i = 0; i < 4; i++)
      dispatcher.publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
    assertFalse(logs.isEmpty(), "outcomes were logged");
    assertTrue(
        logs.stream()
            .anyMatch(
                event -> event.getFormattedMessage().contains("https://fcm.googleapis.com/...")),
        "the endpoint appears truncated to its host");
    assertNoSecretsInLogs();
  }

  void assertNoSecretsInLogs() {
    for (var event : logs) {
      String line = event.getFormattedMessage();
      assertFalse(line.contains("super-secret-device-capability"), line);
      assertFalse(line.contains(server.privateKey), line);
      assertFalse(line.contains(browser.privateKey), line);
      assertFalse(line.contains(recipient.auth()), line);
      if (event.getThrowableProxy() != null)
        assertFalse(event.getThrowableProxy().getMessage().contains(server.privateKey));
    }
  }

  PushMessage message() {
    return PushMessage.of(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
  }
}

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
import java.util.concurrent.atomic.AtomicInteger;
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
    assertTrue(request.headers().firstValue("Topic").isEmpty(), "the Topic header is not sent");
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

  @Test
  void theReasonIsReadStrictlyFromTheRefusalBody() {
    assertEquals(
        "BadJwtToken", WebPushChannelSender.reasonOf(body("{\"reason\":\"BadJwtToken\"}")));
    assertEquals(
        "VapidPkHashMismatch",
        WebPushChannelSender.reasonOf(body("{ \"reason\" : \"VapidPkHashMismatch\" }")));
    assertEquals("a".repeat(40), WebPushChannelSender.reasonOf(body(json("a".repeat(40)))));
  }

  @Test
  void noReasonWhenTheBodyIsEmptyOrAbsent() {
    assertNull(WebPushChannelSender.reasonOf(new byte[0]));
    assertNull(WebPushChannelSender.reasonOf(null));
    assertNull(WebPushChannelSender.reasonOf(body("")));
  }

  @Test
  void aReasonBeyondTheReadLimitIsNotInventedFromAPartialValue() {
    var padded = body("x".repeat(WebPushChannelSender.MAX_REASON_BYTES - 12) + json("BadJwtToken"));
    byte[] head = java.util.Arrays.copyOf(padded, WebPushChannelSender.MAX_REASON_BYTES);
    assertNull(WebPushChannelSender.reasonOf(head), "the value is cut before its closing quote");
    byte[] whole = body(json("BadJwtToken") + "x".repeat(4000));
    assertEquals(
        "BadJwtToken",
        WebPushChannelSender.reasonOf(
            java.util.Arrays.copyOf(whole, WebPushChannelSender.MAX_REASON_BYTES)));
  }

  @Test
  void anyValueOutsideTheTokenPatternIsIgnored() {
    for (String value :
        List.of(
            "Bad_Jwt", "Bad1", "a".repeat(41), "<script>", "Bad Jwt", "", "ñandú", "BadJwt\\\"x")) {
      assertNull(WebPushChannelSender.reasonOf(body(json(value))), value);
    }
    assertNull(WebPushChannelSender.reasonOf(body("{\"reason\":\"BadJwt")), "not closed");
    assertNull(WebPushChannelSender.reasonOf(body("{\"reason\":42}")), "not a string");
  }

  @Test
  void otherBodyContentGivesNoReason() {
    assertNull(
        WebPushChannelSender.reasonOf(
            body("{\"error\":\"Forbidden\",\"message\":\"" + ENDPOINT + "\"}")));
    assertNull(WebPushChannelSender.reasonOf(body("<html>gateway</html>")));
  }

  @Test
  void invalidUtf8NeverThrowsAndStillFindsAValidToken() {
    byte[] raw = concat(new byte[] {(byte) 0xFF, (byte) 0xC3, 0x28}, body(json("BadJwtToken")));
    assertEquals("BadJwtToken", WebPushChannelSender.reasonOf(raw));
  }

  @Test
  void aRefusalKeepsTheReasonOnlyWhenTheBodyHasOne() {
    var withReason =
        new WebPushChannelSender(
            keys(),
            PushSettings.defaults(),
            new WebPushChannelSender.Transport() {
              @Override
              public int send(HttpRequest request) {
                throw new AssertionError("exchange is used");
              }

              @Override
              public WebPushChannelSender.Reply exchange(HttpRequest request) {
                return new WebPushChannelSender.Reply(400, body(json("BadJwtToken")));
              }
            });
    assertEquals(
        new PushChannelSender.Delivery(Result.REJECTED, 400, "BadJwtToken"),
        withReason.deliver(recipient, message()));
    var withoutReason = new WebPushChannelSender(keys(), PushSettings.defaults(), request -> 400);
    assertEquals(
        new PushChannelSender.Delivery(Result.REJECTED, 400, null),
        withoutReason.deliver(recipient, message()));
  }

  @Test
  void theJdkTransportReadsOnlyTheHeadOfALongRefusalBody() throws Exception {
    var padding = "y".repeat(5000);
    var server =
        serve(
            exchange -> {
              byte[] reply = body(json("BadJwtToken") + padding);
              exchange.sendResponseHeaders(400, reply.length);
              exchange.getResponseBody().write(reply);
              exchange.close();
            });
    try {
      var reply = jdkExchange(server, PushSettings.defaults());
      assertEquals(400, reply.status());
      assertEquals(WebPushChannelSender.MAX_REASON_BYTES, reply.head().length);
      assertEquals("BadJwtToken", WebPushChannelSender.reasonOf(reply.head()));
    } finally {
      server.stop(0);
    }
  }

  @Test
  void aSlowRefusalBodyIsAbandonedAtTheOperationTimeout() throws Exception {
    var server =
        serve(
            exchange -> {
              exchange.sendResponseHeaders(400, 100);
              exchange.getResponseBody().flush();
              try {
                Thread.sleep(4000);
              } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
              }
              exchange.close();
            });
    try {
      var started = System.nanoTime();
      var reply = jdkExchange(server, oneSecondOperation());
      var elapsed = Duration.ofNanos(System.nanoTime() - started);
      assertEquals(400, reply.status(), "the status arrived before the body");
      assertEquals(0, reply.head().length, "no partial body is kept");
      assertTrue(
          elapsed.compareTo(Duration.ofSeconds(3)) < 0, "bounded by the timeout: " + elapsed);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void aSuccessfulResponseReadsNoBodyAtAll() throws Exception {
    var server =
        serve(
            exchange -> {
              exchange.sendResponseHeaders(201, -1);
              exchange.close();
            });
    try {
      var reply = jdkExchange(server, PushSettings.defaults());
      assertEquals(201, reply.status());
      assertEquals(0, reply.head().length);
    } finally {
      server.stop(0);
    }
  }

  @Test
  void aVapidKeyMismatchIsGoneAndAnyOtherRefusalIsStillRejected() {
    assertEquals(
        new PushChannelSender.Delivery(Result.GONE, 400, "VapidPkHashMismatch"),
        deliverWith(400, json("VapidPkHashMismatch")));
    assertEquals(Result.REJECTED, deliverWith(400, json("BadWebPushTopic")).result());
    assertEquals(Result.REJECTED, deliverWith(400, json("BadJwtToken")).result());
    assertEquals(Result.REJECTED, deliverWith(400, "").result(), "400 without reason");
    assertEquals(
        Result.REJECTED,
        deliverWith(403, json("VapidPkHashMismatch")).result(),
        "the reason counts only on a 400");
  }

  @Test
  void theDispatcherRevokesOnlyAVapidKeyMismatchAndLogsItWithoutTheEndpoint() {
    var mismatch = publishAgainst(400, json("VapidPkHashMismatch"));
    assertEquals(List.of(recipient.subscriptionId()), mismatch.subscriptions().gone);
    assertEquals(1, mismatch.calls(), "a revocation is never retried");
    assertTrue(
        logs.stream()
            .map(ILoggingEvent::getFormattedMessage)
            .anyMatch(text -> text.contains("is gone; revoked")),
        "an informative line, as for a 410");
    assertNoSecretsInLogs();

    for (String refusal : List.of(json("BadWebPushTopic"), json("BadJwtToken"), "")) {
      var other = publishAgainst(400, refusal);
      assertTrue(other.subscriptions().gone.isEmpty(), refusal);
      assertEquals(1, other.calls(), "refused, not retried");
    }
  }

  record Outcome(PushNotificationDispatcherTest.FakeSubscriptions subscriptions, int calls) {}

  /** Publishes one notice through the real sender, against a push service that answers this. */
  Outcome publishAgainst(int status, String responseBody) {
    var subscriptions = new PushNotificationDispatcherTest.FakeSubscriptions();
    subscriptions.recipients.add(recipient);
    var calls = new AtomicInteger();
    var sender =
        new WebPushChannelSender(
            keys(),
            PushSettings.defaults(),
            new WebPushChannelSender.Transport() {
              @Override
              public int send(HttpRequest request) {
                throw new AssertionError("exchange is used");
              }

              @Override
              public WebPushChannelSender.Reply exchange(HttpRequest request) {
                calls.incrementAndGet();
                return new WebPushChannelSender.Reply(status, body(responseBody));
              }
            });
    var dispatcher =
        new PushNotificationDispatcher(
            subscriptions,
            List.of(sender),
            Runnable::run,
            PushSettings.defaults(),
            () -> Instant.parse("2026-11-20T17:00:00Z"),
            duration -> {});
    dispatcher.publish(OrderPushEvent.of(UUID.randomUUID(), Kind.READY));
    return new Outcome(subscriptions, calls.get());
  }

  PushChannelSender.Delivery deliverWith(int status, String responseBody) {
    var sender =
        new WebPushChannelSender(
            keys(),
            PushSettings.defaults(),
            new WebPushChannelSender.Transport() {
              @Override
              public int send(HttpRequest request) {
                throw new AssertionError("exchange is used");
              }

              @Override
              public WebPushChannelSender.Reply exchange(HttpRequest request) {
                return new WebPushChannelSender.Reply(status, body(responseBody));
              }
            });
    return sender.deliver(recipient, message());
  }

  static byte[] body(String text) {
    return text.getBytes(java.nio.charset.StandardCharsets.UTF_8);
  }

  static String json(String reason) {
    return "{\"reason\":\"" + reason + "\"}";
  }

  static byte[] concat(byte[] first, byte[] second) {
    byte[] out = java.util.Arrays.copyOf(first, first.length + second.length);
    System.arraycopy(second, 0, out, first.length, second.length);
    return out;
  }

  static PushSettings oneSecondOperation() {
    return new PushSettings(
        Duration.ofMinutes(15),
        Duration.ofHours(1),
        "high",
        "normal",
        Duration.ofSeconds(5),
        Duration.ofSeconds(1),
        2,
        Duration.ZERO,
        20,
        Duration.ofMinutes(10));
  }

  static com.sun.net.httpserver.HttpServer serve(com.sun.net.httpserver.HttpHandler handler)
      throws IOException {
    var server =
        com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/push", handler);
    server.start();
    return server;
  }

  static WebPushChannelSender.Reply jdkExchange(
      com.sun.net.httpserver.HttpServer server, PushSettings settings) throws Exception {
    var request =
        HttpRequest.newBuilder(
                java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/push"))
            .POST(HttpRequest.BodyPublishers.ofString("x"))
            .timeout(Duration.ofSeconds(10))
            .build();
    return WebPushChannelSender.jdkTransport(settings).exchange(request);
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

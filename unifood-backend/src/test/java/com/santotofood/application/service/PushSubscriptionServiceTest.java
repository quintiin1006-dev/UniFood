package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.exception.PushSubscriptionException;
import com.santotofood.application.model.PushSubscriberRole;
import com.santotofood.application.model.PushSubscriptionRegistration;
import com.santotofood.application.model.UserAuthorization;
import com.santotofood.application.port.out.AuthorizationQueryPort;
import com.santotofood.application.port.out.PushSubscriptionPort;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class PushSubscriptionServiceTest {
  static final String ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
  static final String P256DH = "B" + "A".repeat(86);
  static final String AUTH = "A".repeat(22);
  final AuthorizationQueryPort queries = mock(AuthorizationQueryPort.class);
  final PushSubscriptionPort port = mock(PushSubscriptionPort.class);
  final AtomicReference<Instant> clock =
      new AtomicReference<>(Instant.parse("2026-11-20T17:00:00Z"));
  final PushSubscriptionService service =
      new PushSubscriptionService(new OrderAuthorizationService(queries), port, clock::get);
  final UUID user = UUID.randomUUID();
  final UUID cafeteria = UUID.randomUUID();

  void as(boolean active, Set<String> roles, List<UUID> cafeterias) {
    when(queries.findUserAuthorization(user))
        .thenReturn(Optional.of(new UserAuthorization(active, roles, cafeterias)));
  }

  PushSubscriptionRegistration device() {
    return new PushSubscriptionRegistration(ENDPOINT, P256DH, AUTH, "Mozilla/5.0");
  }

  @Test
  void aClientRegistersWithoutCafeteriaAndTheFiveDeviceLimit() {
    as(true, Set.of("CLIENT"), List.of());
    var id = UUID.randomUUID();
    when(port.upsert(eq(user), eq(PushSubscriberRole.CLIENT), isNull(), any(), eq(5)))
        .thenReturn(id);
    assertEquals(id, service.subscribe(user, PushSubscriberRole.CLIENT, device()));
  }

  @Test
  void aWorkerRegistersWithTheCafeteriaFromTheDatabase() {
    as(true, Set.of("WORKER"), List.of(cafeteria));
    service.subscribe(user, PushSubscriberRole.WORKER, device());
    verify(port).upsert(eq(user), eq(PushSubscriberRole.WORKER), eq(cafeteria), any(), eq(5));
  }

  @Test
  void theRoleIsCheckedInTheDatabaseNeverTrustedFromTheRoute() {
    as(true, Set.of("WORKER"), List.of(cafeteria));
    assertKind(
        PushSubscriptionException.Kind.FORBIDDEN,
        () -> service.subscribe(user, PushSubscriberRole.CLIENT, device()));
    as(true, Set.of("CLIENT"), List.of());
    assertKind(
        PushSubscriptionException.Kind.FORBIDDEN,
        () -> service.subscribe(user, PushSubscriberRole.WORKER, device()));
    as(false, Set.of("CLIENT"), List.of());
    assertKind(
        PushSubscriptionException.Kind.FORBIDDEN,
        () -> service.subscribe(user, PushSubscriberRole.CLIENT, device()));
    as(true, Set.of("ADMIN"), List.of(cafeteria));
    assertKind(
        PushSubscriptionException.Kind.FORBIDDEN,
        () -> service.subscribe(user, PushSubscriberRole.WORKER, device()));
    verifyNoInteractions(port);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "http://fcm.googleapis.com/fcm/send/abc",
        "https://example.com/push",
        "https://127.0.0.1/push",
        "https://fcm.googleapis.com.attacker.example/x",
        " https://fcm.googleapis.com/fcm/send/abc",
        "https://fcm.googleapis.com/x#fragment"
      })
  void onlyThePushServicesOfTheSupportedBrowsersAreAccepted(String endpoint) {
    as(true, Set.of("CLIENT"), List.of());
    assertKind(
        PushSubscriptionException.Kind.INVALID,
        () ->
            service.subscribe(
                user,
                PushSubscriberRole.CLIENT,
                new PushSubscriptionRegistration(endpoint, P256DH, AUTH, null)));
  }

  @Test
  void allSupportedPushServicesAreAccepted() {
    for (String endpoint :
        List.of(
            "https://fcm.googleapis.com/fcm/send/x",
            "https://updates.push.services.mozilla.com/wpush/v2/x",
            "https://web.push.apple.com/QH-x",
            "https://wns2-par02p.notify.windows.com/w/?token=x"))
      assertTrue(PushEndpointPolicy.allowedEndpoint(endpoint), endpoint);
  }

  @Test
  void malformedKeysAreRefused() {
    as(true, Set.of("CLIENT"), List.of());
    assertKind(
        PushSubscriptionException.Kind.INVALID,
        () ->
            service.subscribe(
                user,
                PushSubscriberRole.CLIENT,
                new PushSubscriptionRegistration(ENDPOINT, "short", AUTH, null)));
    assertKind(
        PushSubscriptionException.Kind.INVALID,
        () ->
            service.subscribe(
                user,
                PushSubscriberRole.CLIENT,
                new PushSubscriptionRegistration(ENDPOINT, P256DH, "bad auth!", null)));
  }

  @Test
  void theUserAgentIsCleanedAndCut() {
    as(true, Set.of("CLIENT"), List.of());
    service.subscribe(
        user,
        PushSubscriberRole.CLIENT,
        new PushSubscriptionRegistration(ENDPOINT, P256DH, AUTH, "a\nb" + "x".repeat(400)));
    verify(port)
        .upsert(
            eq(user),
            any(),
            any(),
            argThat(
                device -> device.userAgent().length() == 256 && !device.userAgent().contains("\n")),
            anyInt());
  }

  @Test
  void registrationsAreRateLimitedPerUser() {
    as(true, Set.of("CLIENT"), List.of());
    for (int i = 0; i < PushSubscriptionService.REQUESTS_PER_MINUTE; i++)
      service.subscribe(user, PushSubscriberRole.CLIENT, device());
    assertKind(
        PushSubscriptionException.Kind.RATE_LIMITED,
        () -> service.subscribe(user, PushSubscriberRole.CLIENT, device()));
    assertKind(
        PushSubscriptionException.Kind.RATE_LIMITED,
        () -> service.unsubscribe(user, ENDPOINT, null));
    clock.set(clock.get().plus(Duration.ofSeconds(61)));
    assertDoesNotThrow(() -> service.subscribe(user, PushSubscriberRole.CLIENT, device()));
  }

  @Test
  void anyAccountMayRemoveItsOwnDeviceByEndpointOrId() {
    var id = UUID.randomUUID();
    service.unsubscribe(user, ENDPOINT, null);
    service.unsubscribe(user, null, id);
    verify(port).revokeOwnEndpoint(user, ENDPOINT);
    verify(port).revokeOwnSubscription(user, id);
    verifyNoInteractions(queries);
  }

  @Test
  void removalNeedsExactlyOneTarget() {
    assertKind(PushSubscriptionException.Kind.INVALID, () -> service.unsubscribe(user, null, null));
    assertKind(
        PushSubscriptionException.Kind.INVALID,
        () -> service.unsubscribe(user, ENDPOINT, UUID.randomUUID()));
    assertKind(PushSubscriptionException.Kind.INVALID, () -> service.unsubscribe(user, "", null));
    verifyNoInteractions(port);
  }

  static void assertKind(PushSubscriptionException.Kind kind, Runnable action) {
    var error = assertThrows(PushSubscriptionException.class, action::run);
    assertEquals(kind, error.kind());
  }
}

package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.PushSubscriptionRequests.PublicKey;
import com.santotofood.adapter.in.web.dto.PushSubscriptionRequests.Subscribe;
import com.santotofood.adapter.in.web.dto.PushSubscriptionRequests.Subscribed;
import com.santotofood.adapter.in.web.dto.PushSubscriptionRequests.Unsubscribe;
import com.santotofood.application.exception.PushSubscriptionException;
import com.santotofood.application.model.PushSubscriberRole;
import com.santotofood.application.model.PushSubscriptionRegistration;
import com.santotofood.application.port.in.ManagePushSubscriptionsUseCase;
import com.santotofood.config.OrderAuthorization;
import com.santotofood.config.PushConfiguration.PushIdentity;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Devices for push notifications. The client registers under /api/me, the worker under /api/worker;
 * the service checks the role and the worker's cafeteria in the database. Removal is the same for
 * both: only the caller's own rows, answered 204 whether or not a row matched.
 */
@RestController
@PreAuthorize("isAuthenticated()")
public class PushSubscriptionController {
  private final ManagePushSubscriptionsUseCase subscriptions;
  private final OrderAuthorization authorization;
  private final PushIdentity identity;

  public PushSubscriptionController(
      ManagePushSubscriptionsUseCase subscriptions,
      OrderAuthorization authorization,
      PushIdentity identity) {
    this.subscriptions = subscriptions;
    this.authorization = authorization;
    this.identity = identity;
  }

  @GetMapping({"/api/me/push/public-key", "/api/worker/push/public-key"})
  public ResponseEntity<PublicKey> publicKey(Authentication authentication) {
    user(authentication);
    return identity
        .publicKey()
        .map(
            key ->
                ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new PublicKey(key)))
        .orElseThrow(PushDisabledException::new);
  }

  @PostMapping("/api/me/push/subscribe")
  public ResponseEntity<Subscribed> subscribeClient(
      Authentication authentication, @RequestBody Subscribe body) {
    return subscribe(authentication, PushSubscriberRole.CLIENT, body);
  }

  @PostMapping("/api/worker/push/subscribe")
  public ResponseEntity<Subscribed> subscribeWorker(
      Authentication authentication, @RequestBody Subscribe body) {
    return subscribe(authentication, PushSubscriberRole.WORKER, body);
  }

  @DeleteMapping({"/api/me/push/subscribe", "/api/worker/push/subscribe"})
  public ResponseEntity<Void> unsubscribe(
      Authentication authentication, @RequestBody Unsubscribe body) {
    if (body == null) throw PushSubscriptionException.invalid();
    subscriptions.unsubscribe(user(authentication), body.endpoint(), body.subscriptionId());
    return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
  }

  private ResponseEntity<Subscribed> subscribe(
      Authentication authentication, PushSubscriberRole role, Subscribe body) {
    var user = user(authentication);
    if (body == null || body.keys() == null) throw PushSubscriptionException.invalid();
    var id =
        subscriptions.subscribe(
            user,
            role,
            new PushSubscriptionRegistration(
                body.endpoint(), body.keys().p256dh(), body.keys().auth(), body.userAgent()));
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Subscribed(id));
  }

  private UUID user(Authentication authentication) {
    return authorization
        .authenticatedUser(authentication)
        .orElseThrow(() -> new AccessDeniedException("Push identity unavailable"));
  }

  /** No valid VAPID identity configured: the web hides the switch and keeps in-app notices. */
  public static class PushDisabledException extends RuntimeException {
    public PushDisabledException() {
      super("Push disabled", null, false, false);
    }
  }
}

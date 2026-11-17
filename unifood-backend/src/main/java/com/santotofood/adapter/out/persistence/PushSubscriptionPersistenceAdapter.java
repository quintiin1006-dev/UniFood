package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.PushRecipient;
import com.santotofood.application.model.PushSubscriberRole;
import com.santotofood.application.model.PushSubscriptionRegistration;
import com.santotofood.application.port.out.PushSubscriptionPort;
import com.santotofood.domain.model.OrderPushEvent;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
public class PushSubscriptionPersistenceAdapter implements PushSubscriptionPort {
  private static final String UPSERT = sql("upsert");
  private static final String REVOKE_EXCESS = sql("revoke-excess");
  private static final String CLIENT_RECIPIENTS = sql("recipients-client");
  private static final String WORKER_RECIPIENTS = sql("recipients-workers");
  private static final String LOCK_USER =
      "SELECT pg_advisory_xact_lock(hashtextextended('push_subscriptions:' || ?::text, 0))";
  private static final String REVOKE_ENDPOINT =
      "UPDATE public.push_subscriptions SET revoked_at = now() "
          + "WHERE user_id = ? AND endpoint = ? AND revoked_at IS NULL";
  private static final String REVOKE_ID =
      "UPDATE public.push_subscriptions SET revoked_at = now() "
          + "WHERE user_id = ? AND id = ? AND revoked_at IS NULL";
  private static final String MARK_GONE =
      "UPDATE public.push_subscriptions SET revoked_at = now() WHERE id = ? AND revoked_at IS NULL";

  private static final RowMapper<PushRecipient> RECIPIENT =
      (row, index) ->
          new PushRecipient(
              row.getObject("id", UUID.class),
              row.getObject("user_id", UUID.class),
              row.getString("channel"),
              row.getString("endpoint"),
              row.getString("p256dh"),
              row.getString("auth"));

  private final JdbcTemplate jdbc;

  public PushSubscriptionPersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public UUID upsert(
      UUID userId,
      PushSubscriberRole role,
      UUID cafeteriaId,
      PushSubscriptionRegistration device,
      int maxDevices) {
    Objects.requireNonNull(userId);
    Objects.requireNonNull(role);
    if (maxDevices < 1) throw new IllegalArgumentException("maxDevices");
    // Serializes this user's registrations so the device limit holds under parallel requests.
    jdbc.query(LOCK_USER, row -> {}, userId);
    UUID id =
        jdbc.queryForObject(
            UPSERT,
            UUID.class,
            userId,
            role.name(),
            cafeteriaId,
            device.endpoint(),
            device.p256dh(),
            device.auth(),
            device.userAgent());
    jdbc.update(REVOKE_EXCESS, userId, maxDevices);
    return id;
  }

  @Override
  public boolean revokeOwnEndpoint(UUID userId, String endpoint) {
    return jdbc.update(REVOKE_ENDPOINT, userId, endpoint) > 0;
  }

  @Override
  public boolean revokeOwnSubscription(UUID userId, UUID subscriptionId) {
    return jdbc.update(REVOKE_ID, userId, subscriptionId) > 0;
  }

  @Override
  public List<PushRecipient> findRecipients(UUID orderId, OrderPushEvent.Audience audience) {
    return jdbc.query(
        audience == OrderPushEvent.Audience.CLIENT ? CLIENT_RECIPIENTS : WORKER_RECIPIENTS,
        RECIPIENT,
        orderId);
  }

  @Override
  public void markGone(UUID subscriptionId) {
    jdbc.update(MARK_GONE, subscriptionId);
  }

  private static String sql(String name) {
    try {
      return new ClassPathResource("sql/push/" + name + ".sql")
          .getContentAsString(StandardCharsets.UTF_8);
    } catch (IOException exception) {
      throw new IllegalStateException("Push subscription query unavailable", exception);
    }
  }
}

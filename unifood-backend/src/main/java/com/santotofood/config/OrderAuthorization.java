package com.santotofood.config;

import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/** Authorization uses current database assignments, not user-editable metadata. */
@Component("orderAuthorization")
@RequiredArgsConstructor
public class OrderAuthorization {
  private final JdbcTemplate jdbc;

  public boolean cafeteria(Authentication authentication, UUID cafeteriaId) {
    return workerCafeteria(authentication).filter(id -> id.equals(cafeteriaId)).isPresent();
  }

  public Optional<UUID> workerCafeteria(Authentication authentication) {
    if (!(authentication instanceof JwtAuthenticationToken token)) return Optional.empty();
    if (token.getToken().getSubject() == null) return Optional.empty();
    final UUID userId;
    try {
      userId = UUID.fromString(token.getToken().getSubject());
    } catch (IllegalArgumentException exception) {
      return Optional.empty();
    }
    var cafeterias =
        jdbc.queryForList(
            """
              SELECT cu.cafeteria_id FROM public.users u
              JOIN public.user_roles ur ON ur.user_id = u.id
              JOIN public.roles r ON r.id = ur.role_id
              JOIN public.cafeteria_users cu ON cu.user_id = u.id
              WHERE u.id = ? AND u.is_active AND r.name = 'WORKER'
              AND NOT EXISTS (
                SELECT 1 FROM public.user_roles privileged_ur
                JOIN public.roles privileged_r ON privileged_r.id = privileged_ur.role_id
                WHERE privileged_ur.user_id = u.id
                  AND privileged_r.name IN ('ADMIN', 'SUPER_ADMIN')
              )
              LIMIT 2
            """,
            UUID.class,
            userId);
    return cafeterias.size() == 1 ? Optional.of(cafeterias.getFirst()) : Optional.empty();
  }

  public boolean order(Authentication authentication, UUID orderId) {
    var cafeterias =
        jdbc.queryForList(
            "SELECT cafeteria_id FROM public.orders WHERE id = ?", UUID.class, orderId);
    return cafeterias.size() == 1 && cafeteria(authentication, cafeterias.getFirst());
  }
}

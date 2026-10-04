package com.santotofood.config;

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
    if (!(authentication instanceof JwtAuthenticationToken token)) return false;
    if (token.getToken().getSubject() == null) return false;
    final UUID userId;
    try {
      userId = UUID.fromString(token.getToken().getSubject());
    } catch (IllegalArgumentException exception) {
      return false;
    }
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            """
            SELECT EXISTS (
              SELECT 1 FROM public.users u
              JOIN public.user_roles ur ON ur.user_id = u.id
              JOIN public.roles r ON r.id = ur.role_id
              WHERE u.id = ? AND u.is_active AND r.name = 'WORKER'
              AND NOT EXISTS (
                SELECT 1 FROM public.user_roles privileged_ur
                JOIN public.roles privileged_r ON privileged_r.id = privileged_ur.role_id
                WHERE privileged_ur.user_id = u.id
                  AND privileged_r.name IN ('ADMIN', 'SUPER_ADMIN')
              )
              AND EXISTS (
                SELECT 1 FROM public.cafeteria_users cu
                WHERE cu.user_id = u.id AND cu.cafeteria_id = ?
              )
            )
            """,
            Boolean.class,
            userId,
            cafeteriaId));
  }

  public boolean order(Authentication authentication, UUID orderId) {
    var cafeterias =
        jdbc.queryForList(
            "SELECT cafeteria_id FROM public.orders WHERE id = ?", UUID.class, orderId);
    return cafeterias.size() == 1 && cafeteria(authentication, cafeterias.getFirst());
  }
}

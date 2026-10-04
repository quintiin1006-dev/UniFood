package com.santotofood.adapter.out.persistence;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.santotofood.application.model.OrderOwner;
import com.santotofood.application.model.UserAuthorization;
import java.nio.charset.StandardCharsets;
import java.sql.Array;
import java.sql.ResultSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class AuthorizationPersistenceAdapterTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final AuthorizationPersistenceAdapter adapter = new AuthorizationPersistenceAdapter(jdbc);
  private final UUID userId = UUID.randomUUID();
  private final UUID cafeteriaId = UUID.randomUUID();

  private String sql(String file) throws Exception {
    return new ClassPathResource("sql/authorization/" + file)
        .getContentAsString(StandardCharsets.UTF_8);
  }

  private void userRow(boolean active, String[] roles, Object[] cafeterias) throws Exception {
    ResultSet row = mock(ResultSet.class);
    Array roleArray = mock(Array.class);
    Array cafeteriaArray = mock(Array.class);
    when(row.getBoolean("is_active")).thenReturn(active);
    when(row.getArray("roles")).thenReturn(roleArray);
    when(row.getArray("cafeteria_ids")).thenReturn(cafeteriaArray);
    when(roleArray.getArray()).thenReturn(roles);
    when(cafeteriaArray.getArray()).thenReturn(cafeterias);
    when(jdbc.query(eq(sql("user-authorization.sql")), any(RowMapper.class), eq(userId)))
        .thenAnswer(
            call -> {
              RowMapper<UserAuthorization> mapper = call.getArgument(1);
              return List.of(mapper.mapRow(row, 0));
            });
  }

  @Test
  void mapsCurrentFactsWithUuidJdbcArraysWithoutApplyingWorkerPolicy() throws Exception {
    userRow(false, new String[] {"WORKER", "ADMIN"}, new UUID[] {cafeteriaId, UUID.randomUUID()});
    UserAuthorization facts = adapter.findUserAuthorization(userId).orElseThrow();
    assertFalse(facts.active());
    assertEquals(Set.of("WORKER", "ADMIN"), facts.roles());
    assertEquals(2, facts.cafeteriaIds().size());
    assertEquals(cafeteriaId, facts.cafeteriaIds().getFirst());
    verify(jdbc).query(eq(sql("user-authorization.sql")), any(RowMapper.class), eq(userId));
  }

  @Test
  void mapsEmptyArraysAndStringUuidRepresentations() throws Exception {
    userRow(true, new String[] {}, new String[] {});
    assertEquals(
        Optional.of(new UserAuthorization(true, Set.of(), List.of())),
        adapter.findUserAuthorization(userId));
    userRow(true, new String[] {"WORKER"}, new String[] {cafeteriaId.toString()});
    assertEquals(
        List.of(cafeteriaId), adapter.findUserAuthorization(userId).orElseThrow().cafeteriaIds());
  }

  @Test
  void missingUserReturnsEmpty() throws Exception {
    when(jdbc.query(eq(sql("user-authorization.sql")), any(RowMapper.class), eq(userId)))
        .thenReturn(List.of());
    assertTrue(adapter.findUserAuthorization(userId).isEmpty());
  }

  @Test
  void resolvesOnlyAnExistingOrdersActualCafeteria() throws Exception {
    UUID orderId = UUID.randomUUID();
    when(jdbc.queryForList(sql("order-cafeteria.sql"), UUID.class, orderId))
        .thenReturn(List.of(cafeteriaId), List.of());
    assertEquals(Optional.of(cafeteriaId), adapter.findOrderCafeteria(orderId));
    assertTrue(adapter.findOrderCafeteria(orderId).isEmpty());
    verify(jdbc, times(2)).queryForList(sql("order-cafeteria.sql"), UUID.class, orderId);
  }

  @Test
  void ownerLookupDistinguishesLinkedUnlinkedAndMissingOrders() throws Exception {
    UUID orderId = UUID.randomUUID();
    ResultSet row = mock(ResultSet.class);
    when(row.getObject("user_id", UUID.class)).thenReturn(userId, (UUID) null);
    when(jdbc.query(eq(sql("order-owner.sql")), any(RowMapper.class), eq(orderId)))
        .thenAnswer(
            call -> {
              RowMapper<OrderOwner> mapper = call.getArgument(1);
              return List.of(mapper.mapRow(row, 0));
            });
    assertEquals(Optional.of(new OrderOwner(userId)), adapter.findOrderOwner(orderId));
    assertEquals(Optional.of(new OrderOwner(null)), adapter.findOrderOwner(orderId));
    when(jdbc.query(eq(sql("order-owner.sql")), any(RowMapper.class), eq(orderId)))
        .thenReturn(List.of());
    assertTrue(adapter.findOrderOwner(orderId).isEmpty());
    verify(jdbc, times(3)).query(eq(sql("order-owner.sql")), any(RowMapper.class), eq(orderId));
  }

  @Test
  void readsFreshFactsEachTimeWithoutCaching() throws Exception {
    when(jdbc.query(eq(sql("user-authorization.sql")), any(RowMapper.class), eq(userId)))
        .thenReturn(
            List.of(new UserAuthorization(true, Set.of("WORKER"), List.of(cafeteriaId))),
            List.of(new UserAuthorization(true, Set.of("WORKER"), List.of())));
    assertEquals(
        List.of(cafeteriaId), adapter.findUserAuthorization(userId).orElseThrow().cafeteriaIds());
    assertTrue(adapter.findUserAuthorization(userId).orElseThrow().cafeteriaIds().isEmpty());
    verify(jdbc, times(2))
        .query(eq(sql("user-authorization.sql")), any(RowMapper.class), eq(userId));
  }
}

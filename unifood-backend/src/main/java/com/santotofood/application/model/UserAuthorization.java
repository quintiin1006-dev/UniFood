package com.santotofood.application.model;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Current database facts, without a decision about operational permissions. */
public record UserAuthorization(boolean active, Set<String> roles, List<UUID> cafeteriaIds) {
  public UserAuthorization {
    roles = Set.copyOf(roles);
    cafeteriaIds = List.copyOf(cafeteriaIds);
  }
}

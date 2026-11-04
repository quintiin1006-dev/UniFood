package com.santotofood.domain.port.out;

import com.santotofood.domain.model.Lunch;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LunchRepository {

  Lunch save(Lunch lunch);

  Optional<Lunch> findById(UUID lunchId);

  List<Lunch> findAllByIds(Collection<UUID> lunchIds);

  /**
   * Atomically decreases stock only when the lunch is active and has enough units. Returns false
   * without changing anything otherwise.
   */
  boolean decreaseStock(UUID lunchId, int quantity);
}

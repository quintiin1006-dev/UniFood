package com.santotofood.adapter.out.persistence;

import com.santotofood.adapter.out.persistence.mapper.LunchMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataLunchRepository;
import com.santotofood.domain.model.Lunch;
import com.santotofood.domain.port.out.LunchRepository;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class LunchPersistenceAdapter implements LunchRepository {
  private final SpringDataLunchRepository repository;

  public LunchPersistenceAdapter(SpringDataLunchRepository repository) {
    this.repository = repository;
  }

  @Override
  public Lunch save(Lunch lunch) {
    return LunchMapper.toDomain(repository.save(LunchMapper.toEntity(lunch)));
  }

  @Override
  public Optional<Lunch> findById(UUID lunchId) {
    return repository.findById(lunchId).map(LunchMapper::toDomain);
  }

  @Override
  public List<Lunch> findAllByIds(Collection<UUID> lunchIds) {
    if (lunchIds == null || lunchIds.isEmpty()) {
      return List.of();
    }
    return repository.findByIdIn(lunchIds).stream().map(LunchMapper::toDomain).toList();
  }

  @Override
  public boolean decreaseStock(UUID lunchId, int quantity) {
    return repository.decreaseStock(lunchId, quantity) == 1;
  }
}

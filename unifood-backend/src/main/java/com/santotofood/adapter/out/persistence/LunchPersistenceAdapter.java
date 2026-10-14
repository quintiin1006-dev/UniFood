package com.santotofood.adapter.out.persistence;

import com.santotofood.adapter.out.persistence.mapper.LunchMapper;
import com.santotofood.adapter.out.persistence.repository.SpringDataLunchRepository;
import com.santotofood.domain.model.Lunch;
import com.santotofood.domain.port.out.LunchRepository;
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
}

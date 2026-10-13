package com.santotofood.adapter.out.persistence.mapper;

import com.santotofood.adapter.out.persistence.entity.LunchEntity;
import com.santotofood.domain.model.Lunch;

public final class LunchMapper {
  private LunchMapper() {}

  public static LunchEntity toEntity(Lunch lunch) {
    return new LunchEntity(
        lunch.getId(),
        lunch.getCafeteriaId(),
        lunch.getName(),
        lunch.getDescription(),
        lunch.getPrice(),
        lunch.getImageUrl(),
        lunch.getStock(),
        lunch.isActive(),
        lunch.getCategory());
  }

  public static Lunch toDomain(LunchEntity entity) {
    return Lunch.reconstitute(
        entity.getId(),
        entity.getCafeteriaId(),
        entity.getName(),
        entity.getDescription(),
        entity.getPrice(),
        entity.getImageUrl(),
        entity.getStock(),
        entity.isActive(),
        entity.getCategory());
  }
}

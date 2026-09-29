package com.santotofood.domain.port.out;

import com.santotofood.domain.model.Lunch;

import java.util.Optional;
import java.util.UUID;

public interface LunchRepository {

    Lunch save(Lunch lunch);

    Optional<Lunch> findById(UUID lunchId);
}
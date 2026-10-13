package com.santotofood.adapter.out.persistence.repository;

import com.santotofood.adapter.out.persistence.entity.LunchEntity;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SpringDataLunchRepository extends JpaRepository<LunchEntity, UUID> {}

package com.santotofood.adapter.out.persistence.repository;

import com.santotofood.adapter.out.persistence.entity.LunchEntity;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataLunchRepository extends JpaRepository<LunchEntity, UUID> {

  List<LunchEntity> findByIdIn(Collection<UUID> ids);

  /** Single conditional UPDATE: no lost decrements under concurrent orders. */
  @Modifying(flushAutomatically = true)
  @Query(
      """
      update LunchEntity l
         set l.stock = l.stock - :quantity
       where l.id = :lunchId
         and l.active = true
         and l.stock >= :quantity
      """)
  int decreaseStock(@Param("lunchId") UUID lunchId, @Param("quantity") int quantity);
}

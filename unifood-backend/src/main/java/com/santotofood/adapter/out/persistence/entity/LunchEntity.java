package com.santotofood.adapter.out.persistence.entity;

import com.santotofood.domain.model.CatalogCategory;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "lunches", schema = "public")
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class LunchEntity {
  @Id
  @Column(name = "id", nullable = false)
  private UUID id;

  @Column(name = "cafeteria_id", nullable = false)
  private UUID cafeteriaId;

  @Column(name = "name", nullable = false, length = 150)
  private String name;

  @Column(name = "description", columnDefinition = "text")
  private String description;

  @Column(name = "price", nullable = false, precision = 12, scale = 2)
  private BigDecimal price;

  @Column(name = "image_url", columnDefinition = "text")
  private String imageUrl;

  @Column(name = "stock", nullable = false)
  private int stock;

  @Column(name = "is_active", nullable = false)
  private boolean active;

  // Intentionally nullable until explicit administrative classification is complete.
  @Enumerated(EnumType.STRING)
  @JdbcTypeCode(SqlTypes.NAMED_ENUM)
  @Column(name = "category", columnDefinition = "catalog_category")
  private CatalogCategory category;
}

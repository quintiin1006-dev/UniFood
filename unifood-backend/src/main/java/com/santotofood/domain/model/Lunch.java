package com.santotofood.domain.model;

import java.math.BigDecimal;
import java.util.UUID;
import lombok.Getter;

@Getter
public class Lunch {

  private UUID id;
  private UUID cafeteriaId;

  private String name;
  private String description;

  private BigDecimal price;

  private String imageUrl;

  private int stock;

  private boolean active;

  // Nullable during the 012 classification phase; never infer a default.
  private CatalogCategory category;

  // Constructor explícito para inicializar las propiedades
  // con las que se crea el almuerzo.
  public Lunch(
      UUID id,
      UUID cafeteriaId,
      String name,
      String description,
      BigDecimal price,
      String imageUrl,
      int stock) {
    this(id, cafeteriaId, name, description, price, imageUrl, stock, null);
  }

  public Lunch(
      UUID id,
      UUID cafeteriaId,
      String name,
      String description,
      BigDecimal price,
      String imageUrl,
      int stock,
      CatalogCategory category) {
    if (price == null || price.compareTo(BigDecimal.ZERO) <= 0) {
      throw new IllegalArgumentException("El precio debe ser mayor que cero");
    }

    if (stock < 0) {
      throw new IllegalArgumentException("El stock no puede ser negativo");
    }

    this.id = id;
    this.cafeteriaId = cafeteriaId;
    this.name = name;
    this.description = description;
    this.price = price;
    this.imageUrl = imageUrl;
    this.stock = stock;
    this.category = category;

    this.active = true;
  }

  /** Restores administrative activity and nullable classification without assigning a category. */
  public static Lunch reconstitute(
      UUID id,
      UUID cafeteriaId,
      String name,
      String description,
      BigDecimal price,
      String imageUrl,
      int stock,
      boolean active,
      CatalogCategory category) {
    Lunch lunch = new Lunch(id, cafeteriaId, name, description, price, imageUrl, stock, category);
    lunch.active = active;
    return lunch;
  }

  public void decreaseStock(int quantity) {

    if (quantity <= 0) {
      throw new IllegalArgumentException("La cantidad debe ser mayor que cero");
    }

    if (stock < quantity) {
      throw new IllegalStateException("No hay suficiente stock disponible");
    }

    stock -= quantity;
  }

  public void increaseStock(int quantity) {

    if (quantity <= 0) {
      throw new IllegalArgumentException("La cantidad debe ser mayor que cero");
    }

    stock += quantity;
  }

  public void activate() {
    this.active = true;
  }

  public void deactivate() {
    this.active = false;
  }

  public boolean isAvailable() {
    return active && stock > 0;
  }
}

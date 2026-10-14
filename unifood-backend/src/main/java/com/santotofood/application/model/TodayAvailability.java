package com.santotofood.application.model;

import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.CatalogCategory;
import java.util.List;

public record TodayAvailability(
    BusinessDate businessDate,
    AvailabilitySnapshot.Cafeteria cafeteria,
    List<Category> categories) {
  public record Category(CatalogCategory category, List<AvailabilitySnapshot.Item> items) {}
}

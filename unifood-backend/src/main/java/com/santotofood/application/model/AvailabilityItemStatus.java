package com.santotofood.application.model;

import com.santotofood.domain.model.CatalogCategory;

public record AvailabilityItemStatus(boolean active, CatalogCategory category) {}

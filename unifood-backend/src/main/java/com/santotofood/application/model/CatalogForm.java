package com.santotofood.application.model;

import static com.santotofood.application.exception.AdminCatalogCommandException.Reason.INVALID_REQUEST;

import com.santotofood.application.exception.AdminCatalogCommandException;
import com.santotofood.domain.model.CatalogCategory;
import java.math.BigDecimal;

/** Full commercial replacement, independent of transport and unrelated catalog fields. */
public record CatalogForm(
    String name, String description, BigDecimal price, CatalogCategory category) {
  public CatalogForm {
    if (name == null) throw new AdminCatalogCommandException(INVALID_REQUEST);
    name = name.strip();
    if (invalidText(name)
        || (description != null && invalidText(description))
        || name.isBlank()
        || name.codePointCount(0, name.length()) > 150
        || (description != null && description.codePointCount(0, description.length()) > 2000)
        || price == null
        || price.signum() <= 0
        || price.scale() < 0
        || price.scale() > 2
        || price.compareTo(new BigDecimal("9999999999.99")) > 0
        || category == null) throw new AdminCatalogCommandException(INVALID_REQUEST);
    price = price.setScale(2);
  }

  private static boolean invalidText(String value) {
    return value.codePoints().anyMatch(c -> c == 0 || (c >= 0xD800 && c <= 0xDFFF));
  }
}

package com.santotofood.application.model;

import com.santotofood.domain.model.BusinessDate;
import com.santotofood.domain.model.Order;
import java.util.List;

/** One captured business date for the operational query and its rollover headers. */
public record OperationalOrders(BusinessDate businessDate, List<Order> orders) {}

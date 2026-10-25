package com.santotofood.application.port.out;

import com.santotofood.application.model.AdminDashboard;
import com.santotofood.application.model.AdminDashboardPeriod;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public interface AdminDashboardQueryPort {
  enum Event {
    RECEIVED,
    DELIVERED,
    NOT_COLLECTED
  }

  record Query(UUID cafeteriaId, AdminDashboardPeriod period, int limit) {}

  record Daily(
      LocalDate date,
      Event event,
      BigInteger orders,
      BigDecimal value,
      BigInteger invalidAmounts) {}

  record ItemQuality(
      Event event,
      BigInteger examined,
      BigInteger unusable,
      BigInteger reconcilable,
      BigInteger mismatched,
      BigInteger missingNames) {}

  record DateQuality(String basis, BigInteger examined, BigInteger affected) {}

  boolean cafeteriaExists(UUID authorizedCafeteriaId);

  List<Daily> daily(Query query);

  List<ItemQuality> itemQuality(Query query);

  List<DateQuality> dateQuality(Query query);

  AdminDashboard.Ranking ranking(Query query, Event outcome);
}

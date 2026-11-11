package com.santotofood.application.port.out;

import com.santotofood.application.model.SuperAdminCafeteriaRow;
import java.util.List;

public interface SuperAdminCafeteriaQueryPort {
  /** Rows ordered by institution, site and cafeteria name. */
  List<SuperAdminCafeteriaRow> findCafeteriaTree();
}

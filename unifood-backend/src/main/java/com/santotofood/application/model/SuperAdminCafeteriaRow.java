package com.santotofood.application.model;

import java.util.UUID;

/**
 * One flat row of the institution, site and cafeteria tree. Site and cafeteria fields are null when
 * an institution has no sites or a site has no cafeterias.
 */
public record SuperAdminCafeteriaRow(
    UUID institutionId,
    String institutionName,
    boolean institutionActive,
    UUID siteId,
    String siteName,
    String siteCity,
    Boolean siteActive,
    UUID cafeteriaId,
    String cafeteriaName,
    Boolean cafeteriaVisible,
    boolean cafeteriaHasActiveAdmin,
    String billingModel,
    Integer perOrderFeeCop,
    Integer subscriptionFeeCop,
    Integer billingVersion) {}

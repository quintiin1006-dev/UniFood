package com.santotofood.application.model;

/** Business fields needed by the read-only CLIENT profile. */
public record ClientProfileDetails(String document, String phone, String institution) {}

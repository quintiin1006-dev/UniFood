package com.santotofood.application.model;

/** A browser's Web Push subscription as the web server forwards it, already validated. */
public record PushSubscriptionRegistration(
    String endpoint, String p256dh, String auth, String userAgent) {}

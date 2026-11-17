package com.santotofood.application.model;

/** Who a device belongs to; always decided from the database, never from the request. */
public enum PushSubscriberRole {
  CLIENT,
  WORKER
}

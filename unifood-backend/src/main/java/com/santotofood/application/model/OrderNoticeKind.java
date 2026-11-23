package com.santotofood.application.model;

/** Kinds of the bell inbox; the same values as chk_order_notices_kind (migration 034). */
public enum OrderNoticeKind {
  PREPARING,
  READY,
  CALLED,
  /** Carries the reminder number as its sequence: two reminders are two notices. */
  REMINDER,
  DELIVERED,
  /** Marked by the worker; the daily close writes no notice. */
  NOT_COLLECTED,
  REJECTED,
  CANCELLED_BY_CLIENT
}

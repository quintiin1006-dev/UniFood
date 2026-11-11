package com.santotofood.adapter.in.web.dto;

/** Worker rejection body: only the reason; the order and the worker come from the path and JWT. */
public record RejectOrderRequest(String reason) {}

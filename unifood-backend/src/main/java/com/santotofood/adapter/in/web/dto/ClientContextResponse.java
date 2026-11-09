package com.santotofood.adapter.in.web.dto;

import com.santotofood.application.model.ClientContext;
import java.util.List;
import java.util.UUID;

/** docs/decisiones.md §11 context, plus fullName and activeOrder. Never the document. */
public record ClientContextResponse(
    String fullName,
    Institution institution,
    String clientType,
    List<Site> sites,
    ActiveOrder activeOrder) {

  public record Institution(UUID id, String name) {}

  public record Site(UUID id, String name, List<Cafeteria> cafeterias) {}

  public record Cafeteria(UUID id, String name, boolean open) {}

  public record ActiveOrder(UUID id) {}

  public static ClientContextResponse from(ClientContext context) {
    return new ClientContextResponse(
        context.fullName(),
        new Institution(context.institution().id(), context.institution().name()),
        context.clientType(),
        context.sites().stream()
            .map(
                site ->
                    new Site(
                        site.id(),
                        site.name(),
                        site.cafeterias().stream()
                            .map(c -> new Cafeteria(c.id(), c.name(), c.open()))
                            .toList()))
            .toList(),
        context.activeOrderId() == null ? null : new ActiveOrder(context.activeOrderId()));
  }
}

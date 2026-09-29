package com.santotofood.domain.model;

import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

@Getter
public class Site {

    private UUID id;
    private UUID institutionId;
    private String name;
    private String city;
    private boolean active;
    private Instant createdAt;

    public Site(
            UUID id,
            UUID institutionId,
            String name,
            String city
    ) {
        if (institutionId == null) {
            throw new IllegalArgumentException("La institución es obligatoria");
        }

        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("El nombre de la sede es obligatorio");
        }

        if (city == null || city.isBlank()) {
            throw new IllegalArgumentException("La ciudad de la sede es obligatoria");
        }

        this.id = id;
        this.institutionId = institutionId;
        this.name = name;
        this.city = city;
        this.active = true;
        this.createdAt = Instant.now();
    }

    public static Site reconstitute(
            UUID id,
            UUID institutionId,
            String name,
            String city,
            boolean active,
            Instant createdAt
    ) {
        Site site = new Site(
                id,
                institutionId,
                name,
                city
        );

        site.active = active;
        site.createdAt = createdAt;

        return site;
    }
}
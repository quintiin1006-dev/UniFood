package com.santotofood.domain.model;

import java.time.OffsetDateTime;
import java.util.UUID;

public class Institution {

    private UUID id;
    private String name;
    private String emailDomain;
    private String brandName;
    private boolean active;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;

    public Institution() {
    }

    public Institution(
            UUID id,
            String name,
            String emailDomain,
            String brandName,
            boolean active,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt
    ) {
        this.id = id;
        this.name = name;
        this.emailDomain = emailDomain;
        this.brandName = brandName;
        this.active = active;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmailDomain() {
        return emailDomain;
    }

    public void setEmailDomain(String emailDomain) {
        this.emailDomain = emailDomain;
    }

    public String getBrandName() {
        return brandName;
    }

    public void setBrandName(String brandName) {
        this.brandName = brandName;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(OffsetDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public OffsetDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(OffsetDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
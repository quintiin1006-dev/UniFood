package com.santotofood.adapter.out.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "sites")
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class SiteEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "institution_id", nullable = false)
    private UUID institutionId;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "city", nullable = false, length = 100)
    private String city;

    @Column(name = "is_active", nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
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
@Table(name = "clients")
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class ClientEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false, unique = true)
    private UUID userId;

    @Column(name = "institution_id", nullable = false)
    private UUID institutionId;

    @Column(name = "full_name", nullable = false, length = 150)
    private String fullName;

    @Column(name = "document", nullable = false, unique = true, length = 30)
    private String document;

    @Column(name = "phone", nullable = false, length = 30)
    private String phone;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
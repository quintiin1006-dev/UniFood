package com.santotofood.domain.model;

import lombok.Getter;

import java.util.UUID;

@Getter
public class User {

    private UUID id;
    private String email;
    private boolean active;

    // Constructor explícito para inicializar
    // las propiedades con las que se crea el usuario.

    public User(
            UUID id,
            String email
    ) {
        this.id = id;
        this.email = email;

        this.active = true;
    }

    public void activate() {
        this.active = true;
    }

    public void deactivate() {
        this.active = false;
    }
}
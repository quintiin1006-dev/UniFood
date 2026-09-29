package com.santotofood.domain.port.out;

import com.santotofood.domain.model.User;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository {

    User save(User user);

    Optional<User> findById(UUID userId);
}
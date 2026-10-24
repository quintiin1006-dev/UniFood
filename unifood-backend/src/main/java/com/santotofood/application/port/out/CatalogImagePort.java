package com.santotofood.application.port.out;

import com.santotofood.application.model.CatalogImage.*;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** All mutation methods run inside the caller's short database transaction. */
public interface CatalogImagePort {
  Optional<Operation> findByKey(UUID actor, UUID key);

  Optional<Operation> findOperation(UUID actor, UUID product, UUID operation);

  void reserve(Operation operation, Asset asset);

  Optional<Asset> current(UUID cafeteria, UUID product, UUID image);

  Optional<Asset> lockCurrent(UUID cafeteria, UUID product);

  boolean attach(UUID cafe, UUID product, long expectedVersion, UUID asset);

  void applied(Operation operation, long version);

  void reject(UUID operation, int status, String code);

  void retire(UUID asset);

  List<UUID> cleanupCandidates();

  Optional<Asset> claimCleanup(UUID asset);

  void cleaned(UUID asset, boolean success);
}

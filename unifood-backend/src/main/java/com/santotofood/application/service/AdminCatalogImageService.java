package com.santotofood.application.service;

import com.santotofood.application.exception.CatalogImageException;
import com.santotofood.application.model.AdminCatalogProduct;
import com.santotofood.application.model.CatalogImage.*;
import com.santotofood.application.port.out.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Remote I/O and decoding never run inside a business transaction. */
@Service
public class AdminCatalogImageService {
  private static final Logger LOG = LoggerFactory.getLogger(AdminCatalogImageService.class);
  private final AuthorizationQueryPort authorization;
  private final AdminCatalogCommandPort catalog;
  private final CatalogImagePort images;
  private final ProductImageStorage storage;
  private final ProductImageNormalizer normalizer;
  private final TransactionTemplate writes, reads;
  private final java.util.concurrent.Semaphore transfers = new java.util.concurrent.Semaphore(4);

  public AdminCatalogImageService(
      AuthorizationQueryPort authorization,
      AdminCatalogCommandPort catalog,
      CatalogImagePort images,
      ProductImageStorage storage,
      ProductImageNormalizer normalizer,
      PlatformTransactionManager manager) {
    this.authorization = authorization;
    this.catalog = catalog;
    this.images = images;
    this.storage = storage;
    this.normalizer = normalizer;
    writes = new TransactionTemplate(manager);
    writes.setTimeout(15);
    writes.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    reads = new TransactionTemplate(manager);
    reads.setReadOnly(true);
    reads.setTimeout(15);
    reads.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
  }

  private UUID authorize(UUID actor, boolean mutation) {
    if (mutation) catalog.lockAuthorizationGuard();
    var facts =
        authorization
            .findUserAuthorization(actor)
            .filter(
                f ->
                    f.active() && f.roles().equals(Set.of("ADMIN")) && f.cafeteriaIds().size() == 1)
            .orElseThrow(() -> error(403, "ADMIN_CATALOG_FORBIDDEN"));
    UUID cafe = facts.cafeteriaIds().getFirst();
    if (mutation && !catalog.lockActiveCafeteria(cafe))
      throw error(403, "ADMIN_CATALOG_CAFETERIA_INACTIVE");
    return cafe;
  }

  private AdminCatalogProduct product(UUID cafe, UUID id) {
    return catalog
        .lockProduct(cafe, id)
        .orElseThrow(() -> error(404, "ADMIN_CATALOG_PRODUCT_NOT_FOUND"));
  }

  private void version(AdminCatalogProduct product, long expected) {
    if (expected < 0) throw CatalogImageException.invalid();
    if (product.version() != expected) throw error(409, "ADMIN_CATALOG_STALE_VERSION");
  }

  public Result upload(
      UUID actor, UUID product, UUID key, long expected, byte[] bytes, String mime) {
    // Admit before CPU work. Only a short transaction holds locks.
    writes.executeWithoutResult(
        tx -> {
          UUID cafe = authorize(actor, true);
          product(cafe, product);
        });
    if (!transfers.tryAcquire()) throw CatalogImageException.unavailable();
    try {
      return transfer(actor, product, key, expected, bytes, mime);
    } finally {
      transfers.release();
    }
  }

  private Result transfer(
      UUID actor, UUID product, UUID key, long expected, byte[] bytes, String mime) {
    Content content = normalizer.normalize(bytes, mime);
    String fingerprint =
        ProductImageNormalizer.hash(
            ("UPLOAD:" + expected + ":" + mime + ":" + ProductImageNormalizer.hash(bytes))
                .getBytes(StandardCharsets.UTF_8));
    String bucket = storage.bucket();
    UUID assetId = UUID.randomUUID();
    Result reserved =
        writes.execute(
            tx -> {
              UUID cafe = authorize(actor, true);
              var current = product(cafe, product);
              var previous = images.findByKey(actor, key);
              if (previous.isPresent()) {
                checkReplay(previous.get(), cafe, product, fingerprint);
                return new Result(previous.get(), current);
              }
              version(current, expected);
              String objectKey =
                  "cafeterias/"
                      + cafe
                      + "/products/"
                      + product
                      + "/"
                      + assetId
                      + (mime.equals("image/jpeg") ? ".jpg" : ".png");
              var asset =
                  new Asset(
                      assetId,
                      cafe,
                      product,
                      bucket,
                      objectKey,
                      mime,
                      content.bytes().length,
                      content.width(),
                      content.height(),
                      content.sha256(),
                      "UPLOADING");
              var operation =
                  new Operation(
                      key,
                      actor,
                      cafe,
                      product,
                      key,
                      "UPLOAD",
                      expected,
                      fingerprint,
                      assetId,
                      "PROCESSING",
                      null,
                      null,
                      null,
                      Instant.now().plusSeconds(300));
              images.reserve(operation, asset);
              return new Result(operation, current);
            });
    if (!assetId.equals(reserved.operation().assetId())) return reserved;
    var operation = reserved.operation();
    String objectKey =
        "cafeterias/"
            + operation.cafeteriaId()
            + "/products/"
            + product
            + "/"
            + assetId
            + (mime.equals("image/jpeg") ? ".jpg" : ".png");
    try {
      storage.upload(bucket, objectKey, content);
    } catch (RuntimeException e) {
      rejectSafely(operation, CatalogImageException.unavailable());
      throw CatalogImageException.unavailable();
    }
    try {
      return writes.execute(
          tx -> {
            UUID cafe = authorize(actor, true);
            var current = product(cafe, product);
            var op = images.findByKey(actor, key).orElseThrow(CatalogImageException::unavailable);
            if (!op.state().equals("PROCESSING")) return new Result(op, current);
            if (op.leaseUntil().isBefore(Instant.now())) throw CatalogImageException.unavailable();
            version(current, expected);
            return apply(op, current, assetId);
          });
    } catch (CatalogImageException e) {
      rejectSafely(operation, e);
      throw e;
    } catch (RuntimeException e) {
      // A commit acknowledgement may have been lost. Do not delete or reject the
      // candidate here: the durable journal/current pointer settles the outcome.
      LOG.warn("Catalog image confirmation uncertain operation={}", operation.id());
      throw CatalogImageException.unavailable();
    }
  }

  public Result remove(UUID actor, UUID product, UUID key, long expected) {
    String fingerprint =
        ProductImageNormalizer.hash(("REMOVE:" + expected).getBytes(StandardCharsets.UTF_8));
    return writes.execute(
        tx -> {
          UUID cafe = authorize(actor, true);
          var current = product(cafe, product);
          var previous = images.findByKey(actor, key);
          if (previous.isPresent()) {
            checkReplay(previous.get(), cafe, product, fingerprint);
            return new Result(previous.get(), current);
          }
          version(current, expected);
          var op =
              new Operation(
                  key,
                  actor,
                  cafe,
                  product,
                  key,
                  "REMOVE",
                  expected,
                  fingerprint,
                  null,
                  "PROCESSING",
                  null,
                  null,
                  null,
                  Instant.now().plusSeconds(300));
          images.reserve(op, null);
          return apply(op, current, null);
        });
  }

  private Result apply(Operation op, AdminCatalogProduct current, UUID asset) {
    var old = images.lockCurrent(op.cafeteriaId(), op.productId());
    if (!images.attach(op.cafeteriaId(), op.productId(), current.version(), asset))
      throw error(409, "ADMIN_CATALOG_STALE_VERSION");
    old.ifPresent(a -> images.retire(a.id()));
    var confirmed = product(op.cafeteriaId(), op.productId());
    images.applied(op, confirmed.version());
    return new Result(
        images.findOperation(op.actorId(), op.productId(), op.id()).orElseThrow(), confirmed);
  }

  private void checkReplay(Operation op, UUID cafe, UUID product, String fingerprint) {
    if (!op.cafeteriaId().equals(cafe)
        || !op.productId().equals(product)
        || !op.fingerprint().equals(fingerprint))
      throw error(409, "ADMIN_CATALOG_IMAGE_IDEMPOTENCY_CONFLICT");
  }

  private void rejectSafely(Operation operation, CatalogImageException error) {
    try {
      writes.executeWithoutResult(
          tx -> {
            product(operation.cafeteriaId(), operation.productId());
            images.reject(operation.id(), error.status(), error.code());
          });
    } catch (RuntimeException ignored) {
      LOG.warn("Catalog image recovery pending operation={}", operation.id());
    }
  }

  public Result operation(UUID actor, UUID product, UUID operation) {
    // Reads admit inactive cafeterias, just like the existing catalog GET.
    return writes.execute(
        tx -> {
          UUID cafe = authorize(actor, false);
          var current = product(cafe, product);
          var op =
              images
                  .findOperation(actor, product, operation)
                  .filter(o -> o.cafeteriaId().equals(cafe))
                  .orElseThrow(() -> error(404, "ADMIN_CATALOG_PRODUCT_NOT_FOUND"));
          if (op.state().equals("PROCESSING") && op.leaseUntil().isBefore(Instant.now())) {
            images.reject(op.id(), 503, "ADMIN_CATALOG_IMAGE_TEMPORARILY_UNAVAILABLE");
            op = images.findOperation(actor, product, operation).orElseThrow();
          }
          return new Result(op, current);
        });
  }

  public Content download(UUID actor, UUID product, UUID image) {
    Asset asset =
        reads.execute(
            tx -> {
              UUID cafe = authorize(actor, false);
              return images
                  .current(cafe, product, image)
                  .orElseThrow(() -> error(404, "ADMIN_CATALOG_PRODUCT_NOT_FOUND"));
            });
    byte[] bytes = storage.download(asset.bucket(), asset.objectKey());
    if (bytes.length != asset.byteSize()
        || !ProductImageNormalizer.hash(bytes).equals(asset.sha256()))
      throw CatalogImageException.unavailable();
    return new Content(bytes, asset.contentType(), asset.width(), asset.height(), asset.sha256());
  }

  public void cleanup() {
    for (UUID candidate : images.cleanupCandidates()) {
      Optional<Asset> claimed = writes.execute(tx -> images.claimCleanup(candidate));
      if (claimed.isEmpty()) continue;
      var asset = claimed.get();
      boolean success = false;
      try {
        storage.delete(asset.bucket(), asset.objectKey());
        success = true;
      } catch (RuntimeException e) {
        LOG.warn("Catalog image cleanup deferred asset={}", asset.id());
      }
      boolean completed = success;
      writes.executeWithoutResult(tx -> images.cleaned(asset.id(), completed));
    }
  }

  private static CatalogImageException error(int status, String code) {
    return new CatalogImageException(status, code);
  }
}

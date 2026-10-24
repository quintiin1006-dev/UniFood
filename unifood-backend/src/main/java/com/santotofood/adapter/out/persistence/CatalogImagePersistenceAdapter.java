package com.santotofood.adapter.out.persistence;

import com.santotofood.application.model.CatalogImage.*;
import com.santotofood.application.port.out.CatalogImagePort;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class CatalogImagePersistenceAdapter implements CatalogImagePort {
  private final JdbcTemplate jdbc;

  public CatalogImagePersistenceAdapter(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static Operation operation(ResultSet r, int index) throws SQLException {
    return new Operation(
        r.getObject("id", UUID.class),
        r.getObject("actor_id", UUID.class),
        r.getObject("cafeteria_id", UUID.class),
        r.getObject("product_id", UUID.class),
        r.getObject("idempotency_key", UUID.class),
        r.getString("kind"),
        r.getLong("expected_version"),
        r.getString("fingerprint"),
        r.getObject("asset_id", UUID.class),
        r.getString("state"),
        r.getObject("applied_version", Long.class),
        r.getObject("failure_status", Integer.class),
        r.getString("failure_code"),
        r.getTimestamp("lease_until").toInstant());
  }

  private static Asset asset(ResultSet r, int index) throws SQLException {
    return new Asset(
        r.getObject("id", UUID.class),
        r.getObject("cafeteria_id", UUID.class),
        r.getObject("product_id", UUID.class),
        r.getString("bucket"),
        r.getString("object_key"),
        r.getString("content_type"),
        r.getInt("byte_size"),
        r.getInt("width"),
        r.getInt("height"),
        r.getString("sha256"),
        r.getString("state"));
  }

  public Optional<Operation> findByKey(UUID actor, UUID key) {
    return jdbc
        .query(
            "SELECT * FROM public.catalog_image_operations WHERE actor_id=? AND idempotency_key=? FOR UPDATE",
            CatalogImagePersistenceAdapter::operation,
            actor,
            key)
        .stream()
        .findFirst();
  }

  public Optional<Operation> findOperation(UUID actor, UUID product, UUID id) {
    return jdbc
        .query(
            "SELECT * FROM public.catalog_image_operations WHERE actor_id=? AND product_id=? AND id=?",
            CatalogImagePersistenceAdapter::operation,
            actor,
            product,
            id)
        .stream()
        .findFirst();
  }

  public void reserve(Operation o, Asset a) {
    if (a != null)
      jdbc.update(
          """
        INSERT INTO public.catalog_image_assets(id,cafeteria_id,product_id,bucket,object_key,content_type,byte_size,width,height,sha256,state)
        VALUES (?,?,?,?,?,?,?,?,?,?,'UPLOADING')
        """,
          a.id(),
          a.cafeteriaId(),
          a.productId(),
          a.bucket(),
          a.objectKey(),
          a.contentType(),
          a.byteSize(),
          a.width(),
          a.height(),
          a.sha256());
    jdbc.update(
        """
        INSERT INTO public.catalog_image_operations(id,actor_id,cafeteria_id,product_id,idempotency_key,kind,expected_version,fingerprint,asset_id,state)
        VALUES (?,?,?,?,?,?,?,?,?,'PROCESSING')
        """,
        o.id(),
        o.actorId(),
        o.cafeteriaId(),
        o.productId(),
        o.key(),
        o.kind(),
        o.expectedVersion(),
        o.fingerprint(),
        o.assetId());
  }

  public Optional<Asset> current(UUID cafe, UUID product, UUID image) {
    return jdbc
        .query(
            """
        SELECT a.* FROM public.lunches l JOIN public.catalog_image_assets a ON a.id=l.image_asset_id
        WHERE l.cafeteria_id=? AND l.id=? AND a.id=? AND a.state='CURRENT'
        """,
            CatalogImagePersistenceAdapter::asset,
            cafe,
            product,
            image)
        .stream()
        .findFirst();
  }

  public Optional<Asset> lockCurrent(UUID cafe, UUID product) {
    return jdbc
        .query(
            """
        SELECT a.* FROM public.lunches l JOIN public.catalog_image_assets a ON a.id=l.image_asset_id
        WHERE l.cafeteria_id=? AND l.id=? FOR UPDATE OF a
        """,
            CatalogImagePersistenceAdapter::asset,
            cafe,
            product)
        .stream()
        .findFirst();
  }

  public boolean attach(UUID cafe, UUID product, long version, UUID asset) {
    if (asset != null
        && jdbc.update(
                "UPDATE public.catalog_image_assets SET state='CURRENT' WHERE id=? AND product_id=? AND cafeteria_id=? AND state='UPLOADING'",
                asset,
                product,
                cafe)
            != 1) return false;
    // Remove clears legacy references explicitly. Upload keeps legacy data for migration
    // compatibility;
    // current projections prefer the managed pointer. Retired files can never be attached again.
    return jdbc.update(
            "UPDATE public.lunches SET image_asset_id=?, image_url=CASE WHEN ?::uuid IS NULL THEN NULL ELSE image_url END WHERE cafeteria_id=? AND id=? AND version=?",
            asset,
            asset,
            cafe,
            product,
            version)
        == 1;
  }

  public void applied(Operation o, long version) {
    jdbc.update(
        "UPDATE public.catalog_image_operations SET state='APPLIED',applied_version=? WHERE id=? AND state='PROCESSING'",
        version,
        o.id());
  }

  public void reject(UUID op, int status, String code) {
    jdbc.update(
        "UPDATE public.catalog_image_operations SET state='REJECTED',failure_status=?,failure_code=? WHERE id=? AND state='PROCESSING'",
        status,
        code,
        op);
    jdbc.update(
        """
        UPDATE public.catalog_image_assets a SET state='RETIRED',cleanup_after=now()+interval '24 hours'
        FROM public.catalog_image_operations o WHERE o.id=? AND o.asset_id=a.id AND o.state='REJECTED' AND a.state='UPLOADING'
        """,
        op);
  }

  public void retire(UUID asset) {
    jdbc.update(
        "UPDATE public.catalog_image_assets SET state='RETIRED',cleanup_after=now()+interval '24 hours' WHERE id=? AND state='CURRENT'",
        asset);
  }

  public List<UUID> cleanupCandidates() {
    return jdbc.query(
        "SELECT id FROM public.catalog_image_assets WHERE state IN ('UPLOADING','RETIRED','DELETING') AND cleanup_after<=now() ORDER BY cleanup_after,id LIMIT 20",
        (r, i) -> r.getObject(1, UUID.class));
  }

  public Optional<Asset> claimCleanup(UUID id) {
    // Always product -> asset -> operation, matching association transactions.
    var products =
        jdbc.query(
            "SELECT product_id FROM public.catalog_image_assets WHERE id=?",
            (r, i) -> r.getObject(1, UUID.class),
            id);
    if (products.isEmpty()) return Optional.empty();
    jdbc.queryForList("SELECT id FROM public.lunches WHERE id=? FOR UPDATE", products.getFirst());
    var rows =
        jdbc.query(
            "SELECT * FROM public.catalog_image_assets WHERE id=? AND state IN ('UPLOADING','RETIRED','DELETING') AND cleanup_after<=now() FOR UPDATE",
            CatalogImagePersistenceAdapter::asset,
            id);
    if (rows.isEmpty()) return Optional.empty();
    if (jdbc.queryForObject(
        "SELECT EXISTS(SELECT 1 FROM public.lunches WHERE image_asset_id=?) OR EXISTS(SELECT 1 FROM public.catalog_image_operations WHERE asset_id=? AND state='PROCESSING' AND lease_until>now())",
        Boolean.class,
        id,
        id)) return Optional.empty();
    jdbc.update(
        "UPDATE public.catalog_image_operations SET state='REJECTED',failure_status=503,failure_code='ADMIN_CATALOG_IMAGE_TEMPORARILY_UNAVAILABLE' WHERE asset_id=? AND state='PROCESSING' AND lease_until<=now()",
        id);
    // A lease also prevents two scheduler instances from deleting the same key at once.
    jdbc.update(
        "UPDATE public.catalog_image_assets SET state='DELETING',cleanup_after=now()+interval '5 minutes',attempts=attempts+1 WHERE id=?",
        id);
    return Optional.of(rows.getFirst());
  }

  public void cleaned(UUID id, boolean success) {
    jdbc.update(
        "UPDATE public.catalog_image_assets SET state=?,cleanup_after=now()+interval '1 hour' WHERE id=? AND state='DELETING'",
        success ? "DELETED" : "DELETING",
        id);
  }
}

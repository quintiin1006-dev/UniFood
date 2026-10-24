package com.santotofood.config;

import static com.santotofood.config.AdminCatalogApiPostgresTest.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.santotofood.application.exception.CatalogImageException;
import com.santotofood.application.model.CatalogForm;
import com.santotofood.application.model.CatalogImage.*;
import com.santotofood.application.port.in.ManageAdminCatalogUseCase;
import com.santotofood.application.port.out.ProductImageStorage;
import com.santotofood.application.service.AdminCatalogImageService;
import com.santotofood.application.service.ProductImageNormalizerTest;
import com.santotofood.domain.model.CatalogCategory;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.MockMultipartFile;

@Timeout(60)
class AdminCatalogImagesPostgresTest {
  AdminCatalogImageService images;
  ProductImageStorage storage;
  ManageAdminCatalogUseCase commands;
  final List<UUID> owned = new ArrayList<>();

  @BeforeAll
  static void startImages() throws Exception {
    start();
  }

  @AfterAll
  static void stopImages() throws Exception {
    stop();
  }

  @BeforeEach
  void setup() {
    images = context.getBean(AdminCatalogImageService.class);
    storage = context.getBean(ProductImageStorage.class);
    commands = context.getBean(ManageAdminCatalogUseCase.class);
    reset(storage);
    when(storage.bucket()).thenReturn("product-images");
  }

  @AfterEach
  void cleanup() {
    source.unavailable = false;
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", ADMIN);
    jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
    jdbc.update("UPDATE public.cafeterias SET is_active=false WHERE id=?", OTHER_CAFE);
    for (UUID id : owned) {
      jdbc.update("UPDATE public.lunches SET image_asset_id=NULL WHERE id=?", id);
      jdbc.update("DELETE FROM public.catalog_image_operations WHERE product_id=?", id);
      jdbc.update("DELETE FROM public.catalog_image_assets WHERE product_id=?", id);
      jdbc.update("DELETE FROM public.lunches WHERE id=?", id);
    }
  }

  UUID product() {
    var p =
        commands.create(
            ADMIN,
            new CatalogForm(
                "Image " + UUID.randomUUID(),
                null,
                new BigDecimal("15000.00"),
                CatalogCategory.CORRIENTE));
    owned.add(p.id());
    return p.id();
  }

  byte[] png() throws Exception {
    return ProductImageNormalizerTest.image("png", 300, 300);
  }

  Result upload(UUID p, long v) throws Exception {
    return images.upload(ADMIN, p, UUID.randomUUID(), v, png(), "image/png");
  }

  @Test
  void uploadPrivateReadReplayCommercialResponsesAndRemovalPreserveVersions() throws Exception {
    UUID p = product(), key = UUID.randomUUID();
    final Content[] stored = {null};
    doAnswer(
            a -> {
              stored[0] = a.getArgument(2);
              return null;
            })
        .when(storage)
        .upload(anyString(), anyString(), any());
    var result = images.upload(ADMIN, p, key, 0, png(), "image/png");
    assertEquals("APPLIED", result.operation().state());
    assertEquals(1, result.product().version());
    assertEquals(
        result.product().imageUrl(),
        images.upload(ADMIN, p, key, 0, png(), "image/png").product().imageUrl());
    verify(storage, times(1)).upload(anyString(), anyString(), any());
    when(storage.download(anyString(), anyString())).thenReturn(stored[0].bytes());
    mvc.perform(get(ENDPOINT + "/" + p + "/image/" + result.operation().assetId()).with(as(ADMIN)))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "private, no-store"));
    var edited =
        commands.edit(
            ADMIN,
            p,
            1,
            new CatalogForm(
                "Edited " + p, null, new BigDecimal("16000.00"), CatalogCategory.ESPECIAL));
    assertEquals(result.product().imageUrl(), edited.imageUrl());
    assertEquals(2, edited.version());
    jdbc.update("UPDATE public.cafeterias SET is_active=false WHERE id=?", CAFE);
    assertArrayEquals(
        stored[0].bytes(), images.download(ADMIN, p, result.operation().assetId()).bytes());
    assertEquals(
        403,
        assertThrows(
                CatalogImageException.class, () -> images.remove(ADMIN, p, UUID.randomUUID(), 2))
            .status());
    jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
    var removed = images.remove(ADMIN, p, UUID.randomUUID(), 2);
    assertNull(removed.product().imageUrl());
    assertEquals(3, removed.product().version());
    assertEquals(
        "RETIRED",
        jdbc.queryForObject(
            "SELECT state FROM public.catalog_image_assets WHERE id=?",
            String.class,
            result.operation().assetId()));
    verify(storage, never()).delete(anyString(), anyString());
  }

  @Test
  void jwtSubjectAndTenantAdmissionAreAuthoritativeForMultipartEndpoint() throws Exception {
    UUID p = product();
    var file = new MockMultipartFile("file", "ignored.png", "image/png", png());
    mvc.perform(
            multipart(ENDPOINT + "/" + p + "/image")
                .file(file)
                .param("expectedVersion", "0")
                .header("Idempotency-Key", UUID.randomUUID())
                .with(
                    r -> {
                      r.setMethod("PUT");
                      return r;
                    })
                .with(as(ADMIN)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.product.version").value("1"));
    jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", OTHER_CAFE);
    for (UUID user : List.of(SECOND, WORKER, CLIENT, INACTIVE)) {
      int expected = user.equals(SECOND) ? 404 : 403;
      assertEquals(
          expected,
          assertThrows(
                  CatalogImageException.class, () -> images.remove(user, p, UUID.randomUUID(), 1))
              .status());
    }
    mvc.perform(get(ENDPOINT + "/" + p + "/image/" + UUID.randomUUID()))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void storageFailureAndDuplicateDifferentPayloadDoNotEraseConfirmedImage() throws Exception {
    UUID p = product();
    var first = upload(p, 0);
    doThrow(CatalogImageException.unavailable())
        .when(storage)
        .upload(anyString(), anyString(), any());
    UUID failed = UUID.randomUUID();
    assertEquals(
        503,
        assertThrows(
                CatalogImageException.class,
                () -> images.upload(ADMIN, p, failed, 1, png(), "image/png"))
            .status());
    assertEquals("REJECTED", images.operation(ADMIN, p, failed).operation().state());
    assertEquals(
        first.product().imageUrl(), images.operation(ADMIN, p, failed).product().imageUrl());
    assertEquals(
        409,
        assertThrows(
                CatalogImageException.class,
                () -> images.remove(ADMIN, p, first.operation().key(), 1))
            .status());
    assertEquals(
        409,
        assertThrows(
                CatalogImageException.class, () -> images.remove(ADMIN, p, UUID.randomUUID(), 0))
            .status());
  }

  @Test
  void revokedPermissionsAndConcurrentCommercialWritesDuringTransferPreventAttachment()
      throws Exception {
    UUID p = product();
    doAnswer(
            a -> {
              jdbc.update("UPDATE public.cafeterias SET is_active=false WHERE id=?", CAFE);
              jdbc.update("UPDATE public.users SET is_active=false WHERE id=?", ADMIN);
              return null;
            })
        .when(storage)
        .upload(anyString(), anyString(), any());
    assertEquals(403, assertThrows(CatalogImageException.class, () -> upload(p, 0)).status());
    jdbc.update("UPDATE public.users SET is_active=true WHERE id=?", ADMIN);
    jdbc.update("UPDATE public.cafeterias SET is_active=true WHERE id=?", CAFE);
    doAnswer(
            a -> {
              commands.edit(
                  ADMIN,
                  p,
                  0,
                  new CatalogForm(
                      "Concurrent " + p,
                      null,
                      new BigDecimal("17000.00"),
                      CatalogCategory.CORRIENTE));
              return null;
            })
        .when(storage)
        .upload(anyString(), anyString(), any());
    assertEquals(409, assertThrows(CatalogImageException.class, () -> upload(p, 0)).status());
    assertNull(
        jdbc.queryForObject("SELECT image_asset_id FROM public.lunches WHERE id=?", UUID.class, p));
  }

  @Test
  void simultaneousReplacementsHaveOneWinnerAndLeaveOtherCandidateForCleanup() throws Exception {
    UUID p = product();
    var barrier = new CyclicBarrier(2);
    doAnswer(
            a -> {
              barrier.await(10, TimeUnit.SECONDS);
              return null;
            })
        .when(storage)
        .upload(anyString(), anyString(), any());
    try (var pool = Executors.newFixedThreadPool(2)) {
      Callable<Integer> task =
          () -> {
            try {
              upload(p, 0);
              return 200;
            } catch (CatalogImageException e) {
              return e.status();
            }
          };
      var a = pool.submit(task);
      var b = pool.submit(task);
      assertEquals(
          Set.of(200, 409), Set.of(a.get(20, TimeUnit.SECONDS), b.get(20, TimeUnit.SECONDS)));
    }
    assertEquals(
        1, jdbc.queryForObject("SELECT version FROM public.lunches WHERE id=?", Long.class, p));
    assertEquals(
        1,
        jdbc.queryForObject(
            "SELECT count(*) FROM public.catalog_image_assets WHERE product_id=? AND state='RETIRED'",
            Integer.class,
            p));
  }

  @Test
  void cleanupNeverDeletesCurrentImageAndRetriesFailedPhysicalDeletion() throws Exception {
    UUID p = product();
    var first = upload(p, 0);
    var second = upload(p, 1);
    jdbc.update(
        "UPDATE public.catalog_image_assets SET cleanup_after=now()-interval '1 day' WHERE product_id=?",
        p);
    doThrow(CatalogImageException.unavailable()).when(storage).delete(anyString(), anyString());
    images.cleanup();
    assertEquals(
        "CURRENT",
        jdbc.queryForObject(
            "SELECT state FROM public.catalog_image_assets WHERE id=?",
            String.class,
            second.operation().assetId()));
    doNothing().when(storage).delete(anyString(), anyString());
    jdbc.update(
        "UPDATE public.catalog_image_assets SET cleanup_after=now()-interval '1 day' WHERE id=?",
        first.operation().assetId());
    images.cleanup();
    assertEquals(
        "DELETED",
        jdbc.queryForObject(
            "SELECT state FROM public.catalog_image_assets WHERE id=?",
            String.class,
            first.operation().assetId()));
    assertEquals(
        1, jdbc.queryForObject("SELECT version-1 FROM public.lunches WHERE id=?", Long.class, p));
  }

  @Test
  void databaseFailureAfterUploadIsReconciledWithoutDeletingCandidateOrClaimingSuccess()
      throws Exception {
    UUID p = product(), key = UUID.randomUUID();
    doAnswer(
            a -> {
              source.unavailable = true;
              return null;
            })
        .when(storage)
        .upload(anyString(), anyString(), any());
    assertEquals(
        503,
        assertThrows(
                CatalogImageException.class,
                () -> images.upload(ADMIN, p, key, 0, png(), "image/png"))
            .status());
    source.unavailable = false;
    assertEquals("PROCESSING", images.operation(ADMIN, p, key).operation().state());
    jdbc.update(
        "UPDATE public.catalog_image_operations SET lease_until=now()-interval '1 minute' WHERE id=?",
        key);
    assertEquals("REJECTED", images.operation(ADMIN, p, key).operation().state());
    verify(storage, never()).delete(anyString(), anyString());
  }

  @Test
  void lostCommitAcknowledgementKeepsAttachedAssetAndIdempotentRecoveryFindsSuccess()
      throws Exception {
    UUID p = product(), key = UUID.randomUUID();
    source.loseImageCommitAcknowledgement = true;
    assertEquals(
        503,
        assertThrows(
                CatalogImageException.class,
                () -> images.upload(ADMIN, p, key, 0, png(), "image/png"))
            .status());
    var result = images.operation(ADMIN, p, key);
    assertEquals("APPLIED", result.operation().state());
    assertEquals(1, result.product().version());
    assertEquals(
        "APPLIED", images.upload(ADMIN, p, key, 0, png(), "image/png").operation().state());
    verify(storage, times(1)).upload(anyString(), anyString(), any());
    images.cleanup();
    verify(storage, never()).delete(anyString(), anyString());
  }
}

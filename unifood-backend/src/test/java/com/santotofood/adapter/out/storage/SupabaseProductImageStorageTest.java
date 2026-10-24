package com.santotofood.adapter.out.storage;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.application.exception.CatalogImageException;
import com.santotofood.application.model.CatalogImage.Content;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.*;
import org.junit.jupiter.api.Test;

class SupabaseProductImageStorageTest {
  final String key =
      "cafeterias/00000000-0000-0000-0000-000000000001/products/00000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000003.png";

  @Test
  void privateTransportUsesFixedKeysOpaqueServerCredentialAndBoundedPrivateDownloads()
      throws Exception {
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    var requests = new ArrayList<String>();
    byte[] bytes = {1, 2, 3};
    server.createContext(
        "/storage/v1/object/",
        exchange -> {
          requests.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
          assertEquals("sb_secret_TEST_ONLY", exchange.getRequestHeaders().getFirst("apikey"));
          assertNull(exchange.getRequestHeaders().getFirst("Authorization"));
          if (exchange.getRequestMethod().equals("POST")) {
            assertArrayEquals(bytes, exchange.getRequestBody().readAllBytes());
            assertEquals("false", exchange.getRequestHeaders().getFirst("x-upsert"));
          }
          exchange.sendResponseHeaders(200, bytes.length);
          exchange.getResponseBody().write(bytes);
          exchange.close();
        });
    server.start();
    try {
      var adapter =
          new SupabaseProductImageStorage(
              "http://127.0.0.1:" + server.getAddress().getPort() + "/storage/v1",
              "sb_secret_TEST_ONLY",
              "product-images",
              2,
              2);
      adapter.upload("product-images", key, new Content(bytes, "image/png", 300, 300, "hash"));
      assertArrayEquals(bytes, adapter.download("product-images", key));
      adapter.delete("product-images", key);
      assertEquals(3, requests.size());
      assertTrue(requests.get(1).contains("/object/authenticated/product-images/"));
      assertThrows(CatalogImageException.class, () -> adapter.delete("other-bucket", key));
      assertThrows(
          CatalogImageException.class, () -> adapter.download("product-images", "../../private"));
    } finally {
      server.stop(0);
    }
  }

  @Test
  void disabledStorageIsSafeAndProviderRedirectsAreBlocked() throws Exception {
    var disabled = new SupabaseProductImageStorage("", "", "product-images", 2, 2);
    assertEquals(503, assertThrows(CatalogImageException.class, disabled::bucket).status());
    var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        e -> {
          e.getResponseHeaders().set("Location", "https://PRIVATE.example.invalid");
          e.sendResponseHeaders(302, -1);
          e.close();
        });
    server.start();
    try {
      var adapter =
          new SupabaseProductImageStorage(
              "http://127.0.0.1:" + server.getAddress().getPort() + "/storage/v1",
              "test-only",
              "product-images",
              2,
              2);
      var error =
          assertThrows(CatalogImageException.class, () -> adapter.download("product-images", key));
      assertEquals(503, error.status());
      assertFalse(error.getMessage().contains("PRIVATE"));
    } finally {
      server.stop(0);
    }
  }
}

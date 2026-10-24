package com.santotofood.application.port.out;

import com.santotofood.application.model.CatalogImage.Content;

/** Privileged object transport, independent from user Auth clients. */
public interface ProductImageStorage {
  String bucket();

  void upload(String bucket, String key, Content content);

  byte[] download(String bucket, String key);

  void delete(String bucket, String key);
}

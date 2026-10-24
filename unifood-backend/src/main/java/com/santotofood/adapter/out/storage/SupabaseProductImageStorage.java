package com.santotofood.adapter.out.storage;

import com.santotofood.application.exception.CatalogImageException;
import com.santotofood.application.model.CatalogImage.Content;
import com.santotofood.application.port.out.ProductImageStorage;
import com.santotofood.application.service.ProductImageNormalizer;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class SupabaseProductImageStorage implements ProductImageStorage {
  private final String endpoint, credential, bucket;
  private final Duration timeout;
  private final HttpClient client;

  public SupabaseProductImageStorage(
      @Value("${catalog.images.storage-url:}") String endpoint,
      @Value("${catalog.images.storage-secret:}") String credential,
      @Value("${catalog.images.bucket:product-images}") String bucket,
      @Value("${catalog.images.connect-timeout-seconds:5}") int connect,
      @Value("${catalog.images.operation-timeout-seconds:20}") int operation) {
    this.endpoint = endpoint.replaceAll("/+$", "");
    this.credential = credential;
    this.bucket = bucket;
    if (connect < 1
        || connect > 10
        || operation < 1
        || operation > 30
        || !bucket.matches("[a-z0-9][a-z0-9-]{0,62}"))
      throw new IllegalArgumentException("Invalid product image configuration");
    if (!endpoint.isBlank()) {
      URI uri = URI.create(this.endpoint);
      boolean local =
          uri.getHost() != null
              && List.of("localhost", "127.0.0.1", "[::1]").contains(uri.getHost());
      if (uri.getHost() == null
          || uri.getUserInfo() != null
          || uri.getQuery() != null
          || uri.getFragment() != null
          || !uri.getPath().equals("/storage/v1")
          || !("https".equals(uri.getScheme()) || (local && "http".equals(uri.getScheme()))))
        throw new IllegalArgumentException("Invalid product image endpoint");
    }
    if (endpoint.isBlank() != credential.isBlank())
      throw new IllegalArgumentException("Incomplete product image configuration");
    this.timeout = Duration.ofSeconds(operation);
    this.client =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(connect))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
  }

  public String bucket() {
    if (endpoint.isBlank() || credential.isBlank()) throw CatalogImageException.unavailable();
    return bucket;
  }

  private HttpResponse<byte[]> send(
      String method, String selectedBucket, String key, Content content) {
    bucket();
    if (!bucket.equals(selectedBucket)
        || !key.matches(
            "cafeterias/[a-f0-9-]{36}/products/[a-f0-9-]{36}/[a-f0-9-]{36}\\.(jpg|png)"))
      throw CatalogImageException.unavailable();
    var request =
        HttpRequest.newBuilder(
                URI.create(
                    endpoint
                        + "/object/"
                        + (method.equals("GET") ? "authenticated/" : "")
                        + bucket
                        + "/"
                        + key))
            .timeout(timeout)
            .header("apikey", credential);
    // Opaque sb_secret keys use the gateway apikey header. Legacy service-role JWTs
    // additionally use Authorization. Neither credential is returned to callers.
    if (credential.startsWith("eyJ")) request.header("Authorization", "Bearer " + credential);
    if (content != null)
      request
          .header("Content-Type", content.contentType())
          .header("x-upsert", "false")
          .header("Cache-Control", "max-age=0");
    request.method(
        method,
        content == null
            ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofByteArray(content.bytes()));
    try {
      var response = client.send(request.build(), info -> new LimitedBody());
      if (response.statusCode() / 100 != 2
          && !(method.equals("DELETE") && response.statusCode() == 404))
        throw CatalogImageException.unavailable();
      return response;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw CatalogImageException.unavailable();
    } catch (java.io.IOException e) {
      throw CatalogImageException.unavailable();
    }
  }

  public void upload(String bucket, String key, Content content) {
    send("POST", bucket, key, content);
  }

  public byte[] download(String bucket, String key) {
    return send("GET", bucket, key, null).body();
  }

  public void delete(String bucket, String key) {
    send("DELETE", bucket, key, null);
  }

  private static class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
    private final HttpResponse.BodySubscriber<byte[]> delegate =
        HttpResponse.BodySubscribers.ofByteArray();
    private Flow.Subscription subscription;
    private long size;

    public CompletionStage<byte[]> getBody() {
      return delegate.getBody();
    }

    public void onSubscribe(Flow.Subscription s) {
      subscription = s;
      delegate.onSubscribe(s);
    }

    public void onNext(List<ByteBuffer> buffers) {
      for (var b : buffers) size += b.remaining();
      if (size > ProductImageNormalizer.MAX_BYTES) {
        subscription.cancel();
        delegate.onError(new java.io.IOException("Object exceeds image limit"));
      } else delegate.onNext(buffers);
    }

    public void onError(Throwable error) {
      delegate.onError(error);
    }

    public void onComplete() {
      delegate.onComplete();
    }
  }
}

package com.santotofood.adapter.in.web;

import com.santotofood.adapter.in.web.dto.ClientContextResponse;
import com.santotofood.adapter.in.web.dto.ClientMenuResponse;
import com.santotofood.application.port.in.GetClientContextUseCase;
import com.santotofood.application.port.in.GetClientMenuUseCase;
import com.santotofood.config.OrderAuthorization;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** CLIENT context and menu (docs/decisiones.md §11). Identity comes from the JWT subject. */
@RestController
@RequestMapping("/api/me")
@RequiredArgsConstructor
public class ClientCatalogController {
  // Polled: always revalidated, and only ever stored privately.
  private static final CacheControl MENU_CACHE = CacheControl.noCache().cachePrivate();
  private final GetClientContextUseCase contexts;
  private final GetClientMenuUseCase menus;
  private final OrderAuthorization authorization;

  @GetMapping("/context")
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<ClientContextResponse> context(Authentication authentication) {
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .body(ClientContextResponse.from(contexts.getClientContext(user(authentication))));
  }

  @GetMapping("/menu")
  @PreAuthorize("@orderAuthorization.client(authentication)")
  public ResponseEntity<ClientMenuResponse> menu(
      Authentication authentication,
      @RequestParam UUID cafeteriaId,
      @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch) {
    var body = ClientMenuResponse.from(menus.getClientMenu(user(authentication), cafeteriaId));
    var etag = etag(body);
    if (matches(ifNoneMatch, etag))
      return ResponseEntity.status(HttpStatus.NOT_MODIFIED)
          .eTag(etag)
          .cacheControl(MENU_CACHE)
          .build();
    return ResponseEntity.ok().eTag(etag).cacheControl(MENU_CACHE).body(body);
  }

  private UUID user(Authentication authentication) {
    return authorization
        .authenticatedUser(authentication)
        .orElseThrow(() -> new AccessDeniedException("Client identity unavailable"));
  }

  /** Strong ETag over the whole response: any change in the menu changes it. */
  static String etag(ClientMenuResponse body) {
    try {
      var hash =
          MessageDigest.getInstance("SHA-256")
              .digest(body.toString().getBytes(StandardCharsets.UTF_8));
      return "\"" + HexFormat.of().formatHex(hash, 0, 16) + "\"";
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  /** RFC 9110 weak comparison, as GET allows: a W/ prefix still matches, and so does "*". */
  static boolean matches(String header, String etag) {
    if (header == null || header.isBlank()) return false;
    return Arrays.stream(header.split(","))
        .map(String::trim)
        .map(tag -> tag.startsWith("W/") ? tag.substring(2) : tag)
        .anyMatch(tag -> tag.equals("*") || tag.equals(etag));
  }
}

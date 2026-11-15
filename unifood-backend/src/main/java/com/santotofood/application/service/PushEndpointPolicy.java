package com.santotofood.application.service;

import java.net.URI;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Which push endpoints the backend may ever POST to, and how an endpoint appears in a log.
 *
 * <p>The endpoint comes from the browser, so accepting any URL would let a user make the server
 * send requests to arbitrary hosts. Only HTTPS on the default port to the push services of the
 * supported browsers is accepted, both when registering and again before every send.
 */
public final class PushEndpointPolicy {
  public static final int MAX_ENDPOINT_LENGTH = 2048;
  public static final int MAX_USER_AGENT_LENGTH = 256;

  private static final List<String> EXACT_HOSTS =
      List.of(
          "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet, Opera
          "updates.push.services.mozilla.com", // Firefox
          "push.services.mozilla.com",
          "web.push.apple.com"); // Safari and installed PWAs on iOS 16.4+ and macOS
  private static final List<String> HOST_SUFFIXES =
      List.of(".push.apple.com", ".notify.windows.com"); // Safari; Edge on Windows (WNS)
  private static final Pattern P256DH = Pattern.compile("[A-Za-z0-9_-]{80,100}={0,2}");
  private static final Pattern AUTH = Pattern.compile("[A-Za-z0-9_-]{16,32}={0,2}");

  private PushEndpointPolicy() {}

  public static boolean allowedEndpoint(String endpoint) {
    if (endpoint == null
        || endpoint.isEmpty()
        || endpoint.length() > MAX_ENDPOINT_LENGTH
        || !endpoint.equals(endpoint.strip())) return false;
    final URI uri;
    try {
      uri = new URI(endpoint);
    } catch (Exception invalid) {
      return false;
    }
    if (!"https".equals(uri.getScheme())
        || uri.getRawUserInfo() != null
        || uri.getRawFragment() != null
        || uri.getHost() == null
        || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
    String host = uri.getHost().toLowerCase(Locale.ROOT);
    return EXACT_HOSTS.contains(host) || HOST_SUFFIXES.stream().anyMatch(host::endsWith);
  }

  public static boolean validKeys(String p256dh, String auth) {
    return p256dh != null
        && auth != null
        && P256DH.matcher(p256dh).matches()
        && AUTH.matcher(auth).matches();
  }

  /** Scheme and host only: the path is the device's capability and never reaches a log. */
  public static String redact(String endpoint) {
    if (endpoint == null) return "<none>";
    try {
      URI uri = new URI(endpoint);
      if (uri.getHost() != null) return uri.getScheme() + "://" + uri.getHost() + "/...";
    } catch (Exception ignored) {
      // Fall through: an unparseable endpoint is never printed.
    }
    return "<invalid endpoint>";
  }
}

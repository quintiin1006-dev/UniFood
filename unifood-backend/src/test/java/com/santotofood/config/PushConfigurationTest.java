package com.santotofood.config;

import static org.junit.jupiter.api.Assertions.*;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.math.BigInteger;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/** Without valid VAPID values push is disabled with one clear log line that names no value. */
class PushConfigurationTest {

  @Test
  void missingVapidValuesDisablePushWithAClearWarning() {
    var logs = capture();
    var identity = new PushConfiguration().pushIdentity("", "", "");
    assertTrue(identity.publicKey().isEmpty());
    assertTrue(
        logs.list.stream()
            .anyMatch(
                event ->
                    event.getFormattedMessage().contains("Push notifications disabled")
                        && event.getFormattedMessage().contains("MISSING")));
    release(logs);
  }

  @Test
  void anInvalidPrivateKeyIsNeverPrinted() throws Exception {
    var generator = KeyPairGenerator.getInstance("EC");
    generator.initialize(new ECGenParameterSpec("secp256r1"));
    byte[] raw = ((ECPrivateKey) generator.generateKeyPair().getPrivate()).getS().toByteArray();
    byte[] scalar = new byte[32];
    int start = Math.max(0, raw.length - 32);
    System.arraycopy(raw, start, scalar, 32 - (raw.length - start), raw.length - start);
    String privateKey = Base64.getUrlEncoder().withoutPadding().encodeToString(scalar);
    String publicKey =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(new BigInteger("4" + "1".repeat(129), 16).toByteArray());

    var logs = capture();
    var identity =
        new PushConfiguration().pushIdentity(publicKey, privateKey, "mailto:a@example.invalid");
    assertTrue(identity.publicKey().isEmpty());
    assertFalse(logs.list.isEmpty());
    for (var event : logs.list) {
      assertFalse(event.getFormattedMessage().contains(privateKey));
      assertNull(event.getThrowableProxy(), "no stack trace that could carry key material");
    }
    release(logs);
  }

  static ListAppender<ILoggingEvent> capture() {
    var appender = new ListAppender<ILoggingEvent>();
    appender.start();
    ((Logger) LoggerFactory.getLogger(PushConfiguration.class)).addAppender(appender);
    return appender;
  }

  static void release(ListAppender<ILoggingEvent> appender) {
    ((Logger) LoggerFactory.getLogger(PushConfiguration.class)).detachAppender(appender);
  }
}

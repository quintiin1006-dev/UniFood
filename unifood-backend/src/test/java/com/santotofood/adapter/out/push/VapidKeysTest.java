package com.santotofood.adapter.out.push;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.adapter.out.push.VapidKeys.Problem;
import org.junit.jupiter.api.Test;

class VapidKeysTest {
  final PushTestKeys keys = PushTestKeys.generate();
  static final String SUBJECT = "mailto:soporte@example.invalid";

  @Test
  void aCompletePairLoads() {
    var loaded = VapidKeys.load(keys.publicKey, keys.privateKey, SUBJECT);
    assertTrue(loaded.problem().isEmpty());
    assertEquals(keys.publicKey, loaded.keys().orElseThrow().publicKey());
    assertFalse(loaded.keys().orElseThrow().toString().contains(keys.privateKey));
  }

  @Test
  void missingValuesDisableTheModule() {
    assertEquals(Problem.MISSING, VapidKeys.load("", "", "").problem().orElseThrow());
    assertEquals(Problem.MISSING, VapidKeys.load(null, null, null).problem().orElseThrow());
    assertEquals(
        Problem.MISSING, VapidKeys.load(keys.publicKey, "", SUBJECT).problem().orElseThrow());
    assertEquals(
        Problem.MISSING,
        VapidKeys.load(keys.publicKey, keys.privateKey, " ").problem().orElseThrow());
  }

  @Test
  void malformedOrMismatchedKeysAreReportedByCodeOnly() {
    assertEquals(
        Problem.MALFORMED_PUBLIC_KEY,
        VapidKeys.load("abc", keys.privateKey, SUBJECT).problem().orElseThrow());
    assertEquals(
        Problem.MALFORMED_PRIVATE_KEY,
        VapidKeys.load(keys.publicKey, "%%%", SUBJECT).problem().orElseThrow());
    assertEquals(
        Problem.MISMATCHED_KEYS,
        VapidKeys.load(keys.publicKey, PushTestKeys.generate().privateKey, SUBJECT)
            .problem()
            .orElseThrow());
    assertEquals(
        Problem.INVALID_SUBJECT,
        VapidKeys.load(keys.publicKey, keys.privateKey, "soporte").problem().orElseThrow());
    assertEquals(
        Problem.INVALID_SUBJECT,
        VapidKeys.load(keys.publicKey, keys.privateKey, "http://example.invalid")
            .problem()
            .orElseThrow());
  }
}

package com.santotofood.adapter.out.push;

import java.math.BigInteger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;

/** Throwaway P-256 keys generated per test run, in the web-push CLI's base64url format. */
final class PushTestKeys {
  final String publicKey;
  final String privateKey;

  private PushTestKeys(KeyPair pair) {
    var pub = (ECPublicKey) pair.getPublic();
    var priv = (ECPrivateKey) pair.getPrivate();
    byte[] point = new byte[65];
    point[0] = 0x04;
    copy(pub.getW().getAffineX(), point, 1);
    copy(pub.getW().getAffineY(), point, 33);
    byte[] scalar = new byte[32];
    copy(priv.getS(), scalar, 0);
    this.publicKey = Base64.getUrlEncoder().withoutPadding().encodeToString(point);
    this.privateKey = Base64.getUrlEncoder().withoutPadding().encodeToString(scalar);
  }

  static PushTestKeys generate() {
    try {
      var generator = KeyPairGenerator.getInstance("EC");
      generator.initialize(new ECGenParameterSpec("secp256r1"));
      return new PushTestKeys(generator.generateKeyPair());
    } catch (Exception failure) {
      throw new IllegalStateException(failure);
    }
  }

  /** A browser subscription's 16-byte auth secret. */
  static String authSecret() {
    byte[] secret = new byte[16];
    new java.security.SecureRandom().nextBytes(secret);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
  }

  private static void copy(BigInteger value, byte[] target, int offset) {
    byte[] raw = value.toByteArray();
    int start = Math.max(0, raw.length - 32);
    int length = raw.length - start;
    System.arraycopy(raw, start, target, offset + 32 - length, length);
  }
}

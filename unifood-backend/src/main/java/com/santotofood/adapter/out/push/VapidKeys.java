package com.santotofood.adapter.out.push;

import com.zerodeplibs.webpush.VAPIDKeyPair;
import com.zerodeplibs.webpush.VAPIDKeyPairs;
import com.zerodeplibs.webpush.key.PrivateKeySources;
import com.zerodeplibs.webpush.key.PublicKeySources;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPrivateKeySpec;
import java.util.Base64;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * The application server's VAPID identity, read from VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
 * VAPID_SUBJECT in the format of {@code npx web-push generate-vapid-keys}: base64url, the public
 * key as the 65-byte uncompressed P-256 point and the private key as the 32-byte scalar.
 *
 * <p>No value and no exception message derived from the private key ever reaches a log: a problem
 * is reported by its {@link Problem} code only.
 */
public final class VapidKeys {
  private static final Pattern SUBJECT = Pattern.compile("(mailto:[^\\s@]+@[^\\s@]+|https://\\S+)");

  public enum Problem {
    MISSING,
    MALFORMED_PUBLIC_KEY,
    MALFORMED_PRIVATE_KEY,
    MISMATCHED_KEYS,
    INVALID_SUBJECT
  }

  private final VAPIDKeyPair pair;
  private final String publicKey;
  private final String subject;

  private VapidKeys(VAPIDKeyPair pair, String publicKey, String subject) {
    this.pair = pair;
    this.publicKey = publicKey;
    this.subject = subject;
  }

  /** The keys, or the reason the push module stays disabled. */
  public static Result load(String publicKey, String privateKey, String subject) {
    String pub = publicKey == null ? "" : publicKey.strip();
    String priv = privateKey == null ? "" : privateKey.strip();
    String sub = subject == null ? "" : subject.strip();
    if (pub.isEmpty() && priv.isEmpty() && sub.isEmpty()) return Result.failed(Problem.MISSING);
    if (pub.isEmpty() || priv.isEmpty() || sub.isEmpty()) return Result.failed(Problem.MISSING);
    if (!SUBJECT.matcher(sub).matches()) return Result.failed(Problem.INVALID_SUBJECT);

    final byte[] point;
    final ECPublicKey ecPublic;
    try {
      point = Base64.getUrlDecoder().decode(pub);
      if (point.length != 65 || point[0] != 0x04)
        return Result.failed(Problem.MALFORMED_PUBLIC_KEY);
      ecPublic = (ECPublicKey) PublicKeySources.ofUncompressedBytes(point).extract();
    } catch (RuntimeException malformed) {
      return Result.failed(Problem.MALFORMED_PUBLIC_KEY);
    }

    final ECPrivateKey ecPrivate;
    try {
      byte[] scalar = Base64.getUrlDecoder().decode(priv);
      if (scalar.length != 32) return Result.failed(Problem.MALFORMED_PRIVATE_KEY);
      AlgorithmParameters parameters = AlgorithmParameters.getInstance("EC");
      parameters.init(new ECGenParameterSpec("secp256r1"));
      ECParameterSpec curve = parameters.getParameterSpec(ECParameterSpec.class);
      ecPrivate =
          (ECPrivateKey)
              KeyFactory.getInstance("EC")
                  .generatePrivate(new ECPrivateKeySpec(new BigInteger(1, scalar), curve));
    } catch (Exception malformed) {
      return Result.failed(Problem.MALFORMED_PRIVATE_KEY);
    }

    if (!matches(ecPrivate, ecPublic)) return Result.failed(Problem.MISMATCHED_KEYS);
    VAPIDKeyPair pair =
        VAPIDKeyPairs.of(
            PrivateKeySources.ofECPrivateKey(ecPrivate), PublicKeySources.ofECPublicKey(ecPublic));
    return new Result(Optional.of(new VapidKeys(pair, pub, sub)), Optional.empty());
  }

  /** A signature made with the private key verifies with the public one. */
  private static boolean matches(ECPrivateKey privateKey, ECPublicKey publicKey) {
    try {
      byte[] probe = "unifood-vapid-check".getBytes(StandardCharsets.UTF_8);
      Signature signer = Signature.getInstance("SHA256withECDSA");
      signer.initSign(privateKey);
      signer.update(probe);
      byte[] signature = signer.sign();
      Signature verifier = Signature.getInstance("SHA256withECDSA");
      verifier.initVerify(publicKey);
      verifier.update(probe);
      return verifier.verify(signature);
    } catch (Exception failed) {
      return false;
    }
  }

  VAPIDKeyPair pair() {
    return pair;
  }

  /** Public by design: the browser needs it as applicationServerKey. */
  public String publicKey() {
    return publicKey;
  }

  String subject() {
    return subject;
  }

  @Override
  public String toString() {
    return "VapidKeys[subject set]";
  }

  public record Result(Optional<VapidKeys> keys, Optional<Problem> problem) {
    static Result failed(Problem problem) {
      return new Result(Optional.empty(), Optional.of(problem));
    }
  }
}

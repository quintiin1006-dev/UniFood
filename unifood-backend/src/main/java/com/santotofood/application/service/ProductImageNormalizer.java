package com.santotofood.application.service;

import com.santotofood.application.exception.CatalogImageException;
import com.santotofood.application.model.CatalogImage.Content;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.concurrent.Semaphore;
import java.util.zip.CRC32;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import org.springframework.stereotype.Component;

/** Bounded, raster-only decoding. Never passes original bytes or metadata to Storage. */
@Component
public class ProductImageNormalizer {
  public static final int MAX_BYTES = 3 * 1024 * 1024;
  private final Semaphore decoders = new Semaphore(2);

  public Content normalize(byte[] input, String mime) {
    if (input.length > MAX_BYTES)
      throw new CatalogImageException(413, "ADMIN_CATALOG_IMAGE_TOO_LARGE");
    if (!"image/png".equals(mime) && !"image/jpeg".equals(mime))
      throw new CatalogImageException(415, "ADMIN_CATALOG_IMAGE_UNSUPPORTED_FORMAT");
    if (!decoders.tryAcquire()) throw CatalogImageException.unavailable();
    try {
      boolean png = mime.equals("image/png");
      if (png) validatePng(input);
      else if (input.length < 4
          || (input[0] & 255) != 255
          || (input[1] & 255) != 216
          || (input[input.length - 2] & 255) != 255
          || (input[input.length - 1] & 255) != 217) throw invalidContent();
      try (var stream = new MemoryCacheImageInputStream(new ByteArrayInputStream(input))) {
        var readers = ImageIO.getImageReaders(stream);
        if (!readers.hasNext()) throw invalidContent();
        var reader = readers.next();
        try {
          if (!reader.getFormatName().equalsIgnoreCase(png ? "png" : "jpeg"))
            throw invalidContent();
          reader.setInput(stream, true, true);
          int w = reader.getWidth(0), h = reader.getHeight(0);
          if (Math.min(w, h) < 256 || w > 4096 || h > 4096 || (long) w * h > 16_000_000)
            throw invalidContent();
          final boolean[] warning = {false};
          reader.addIIOReadWarningListener((source, message) -> warning[0] = true);
          BufferedImage decoded = reader.read(0);
          if (decoded == null || warning[0]) throw invalidContent();
          int orientation = png ? 1 : orientation(input);
          BufferedImage oriented = orient(decoded, orientation);
          double scale =
              Math.min(1.0, 1600.0 / Math.max(oriented.getWidth(), oriented.getHeight()));
          int width = Math.max(1, (int) Math.round(oriented.getWidth() * scale));
          int height = Math.max(1, (int) Math.round(oriented.getHeight() * scale));
          var safe =
              new BufferedImage(
                  width, height, png ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
          Graphics2D g = safe.createGraphics();
          try {
            g.setRenderingHint(
                RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g.drawImage(oriented, 0, 0, width, height, null);
          } finally {
            g.dispose();
          }
          var output = new ByteArrayOutputStream();
          if (!ImageIO.write(safe, png ? "png" : "jpeg", output)) throw invalidContent();
          byte[] bytes = output.toByteArray();
          if (bytes.length > MAX_BYTES)
            throw new CatalogImageException(413, "ADMIN_CATALOG_IMAGE_TOO_LARGE");
          return new Content(bytes, mime, width, height, hash(bytes));
        } finally {
          reader.dispose();
        }
      }
    } catch (IOException | IllegalArgumentException e) {
      throw invalidContent();
    } finally {
      decoders.release();
    }
  }

  public static String hash(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (java.security.NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private static CatalogImageException invalidContent() {
    return new CatalogImageException(422, "ADMIN_CATALOG_IMAGE_INVALID_CONTENT");
  }

  private static void validatePng(byte[] b) {
    byte[] signature = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
    if (b.length < 45) throw invalidContent();
    for (int i = 0; i < 8; i++) if (b[i] != signature[i]) throw invalidContent();
    int p = 8;
    boolean end = false;
    boolean first = true;
    while (p <= b.length - 12) {
      int n = ByteBuffer.wrap(b, p, 4).getInt();
      if (n < 0 || n > b.length - p - 12) throw invalidContent();
      String type = new String(b, p + 4, 4, java.nio.charset.StandardCharsets.US_ASCII);
      if (first && (!type.equals("IHDR") || n != 13)) throw invalidContent();
      first = false;
      if (type.equals("acTL") || type.equals("fcTL") || type.equals("fdAT")) throw invalidContent();
      var crc = new CRC32();
      crc.update(b, p + 4, n + 4);
      if ((int) crc.getValue() != ByteBuffer.wrap(b, p + 8 + n, 4).getInt()) throw invalidContent();
      p += n + 12;
      if (type.equals("IEND")) {
        if (n != 0 || p != b.length) throw invalidContent();
        end = true;
        break;
      }
    }
    if (!end) throw invalidContent();
  }

  // Read only the bounded EXIF orientation entry; all original metadata is discarded.
  private static int orientation(byte[] b) {
    int p = 2;
    while (p + 4 <= b.length && (b[p] & 255) == 255) {
      int marker = b[p + 1] & 255;
      if (marker == 218 || marker == 217) break;
      int size = ((b[p + 2] & 255) << 8) | (b[p + 3] & 255);
      if (size < 2 || size > b.length - p - 2) throw invalidContent();
      if (marker == 225
          && size >= 16
          && b[p + 4] == 'E'
          && b[p + 5] == 'x'
          && b[p + 6] == 'i'
          && b[p + 7] == 'f'
          && b[p + 8] == 0
          && b[p + 9] == 0) {
        int start = p + 10, end = p + 2 + size;
        if (start + 8 > end) throw invalidContent();
        ByteOrder order =
            b[start] == 'I' && b[start + 1] == 'I' ? ByteOrder.LITTLE_ENDIAN : ByteOrder.BIG_ENDIAN;
        if (order == ByteOrder.BIG_ENDIAN && (b[start] != 'M' || b[start + 1] != 'M'))
          throw invalidContent();
        var view = ByteBuffer.wrap(b).order(order);
        if (Short.toUnsignedInt(view.getShort(start + 2)) != 42) throw invalidContent();
        long offset = Integer.toUnsignedLong(view.getInt(start + 4));
        if (offset < 8 || offset > end - start - 2) throw invalidContent();
        int table = start + (int) offset, count = Short.toUnsignedInt(view.getShort(table));
        if (count > (end - table - 2) / 12) throw invalidContent();
        for (int i = 0; i < count; i++) {
          int entry = table + 2 + i * 12;
          if (Short.toUnsignedInt(view.getShort(entry)) == 274) {
            if (Short.toUnsignedInt(view.getShort(entry + 2)) != 3 || view.getInt(entry + 4) != 1)
              throw invalidContent();
            int value = Short.toUnsignedInt(view.getShort(entry + 8));
            if (value < 1 || value > 8) throw invalidContent();
            return value;
          }
        }
      }
      p += 2 + size;
    }
    return 1;
  }

  private static BufferedImage orient(BufferedImage in, int orientation) {
    if (orientation == 1) return in;
    int w = in.getWidth(), h = in.getHeight();
    var out =
        new BufferedImage(
            orientation >= 5 ? h : w,
            orientation >= 5 ? w : h,
            in.getColorModel().hasAlpha()
                ? BufferedImage.TYPE_INT_ARGB
                : BufferedImage.TYPE_INT_RGB);
    for (int y = 0; y < h; y++)
      for (int x = 0; x < w; x++) {
        int dx = x, dy = y;
        switch (orientation) {
          case 2 -> dx = w - 1 - x;
          case 3 -> {
            dx = w - 1 - x;
            dy = h - 1 - y;
          }
          case 4 -> dy = h - 1 - y;
          case 5 -> {
            dx = y;
            dy = x;
          }
          case 6 -> {
            dx = h - 1 - y;
            dy = x;
          }
          case 7 -> {
            dx = h - 1 - y;
            dy = w - 1 - x;
          }
          case 8 -> {
            dx = y;
            dy = w - 1 - x;
          }
          default -> throw invalidContent();
        }
        out.setRGB(dx, dy, in.getRGB(x, y));
      }
    return out;
  }
}

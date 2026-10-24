package com.santotofood.application.service;

import static org.junit.jupiter.api.Assertions.*;

import com.santotofood.application.exception.CatalogImageException;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.*;
import java.util.zip.CRC32;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

public class ProductImageNormalizerTest {
  final ProductImageNormalizer normalizer = new ProductImageNormalizer();

  public static byte[] image(String format, int width, int height) throws IOException {
    var out = new ByteArrayOutputStream();
    ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB), format, out);
    return out.toByteArray();
  }

  @Test
  void jpegAndPngAreDecodedResizedAndReencoded() throws Exception {
    for (String format : List.of("jpeg", "png")) {
      var result = normalizer.normalize(image(format, 1800, 900), "image/" + format);
      assertEquals(1600, result.width());
      assertEquals(800, result.height());
      assertEquals(1600, ImageIO.read(new ByteArrayInputStream(result.bytes())).getWidth());
      assertEquals(ProductImageNormalizer.hash(result.bytes()), result.sha256());
    }
  }

  @Test
  void rejectsOversizeUnsupportedForgedCorruptAndInvalidDimensions() throws Exception {
    assertEquals(
        413,
        assertThrows(
                CatalogImageException.class,
                () ->
                    normalizer.normalize(
                        new byte[ProductImageNormalizer.MAX_BYTES + 1], "image/jpeg"))
            .status());
    assertEquals(
        415,
        assertThrows(
                CatalogImageException.class,
                () -> normalizer.normalize(new byte[0], "image/svg+xml"))
            .status());
    assertThrows(
        CatalogImageException.class,
        () -> normalizer.normalize(image("png", 300, 300), "image/jpeg"));
    assertThrows(
        CatalogImageException.class,
        () -> normalizer.normalize(image("jpeg", 200, 300), "image/jpeg"));
    assertThrows(
        CatalogImageException.class,
        () -> normalizer.normalize(image("png", 4097, 256), "image/png"));
    byte[] valid = image("png", 300, 300);
    valid[40] ^= 1;
    assertThrows(CatalogImageException.class, () -> normalizer.normalize(valid, "image/png"));
    byte[] truncated = Arrays.copyOf(image("jpeg", 300, 300), 100);
    assertThrows(CatalogImageException.class, () -> normalizer.normalize(truncated, "image/jpeg"));
  }

  private static byte[] pngChunk(String type, byte[] data) throws Exception {
    var out = new ByteArrayOutputStream();
    var dos = new DataOutputStream(out);
    byte[] name = type.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    dos.writeInt(data.length);
    dos.write(name);
    dos.write(data);
    var crc = new CRC32();
    crc.update(name);
    crc.update(data);
    dos.writeInt((int) crc.getValue());
    return out.toByteArray();
  }

  static byte[] insert(byte[] image, int at, byte[] extra) throws Exception {
    var out = new ByteArrayOutputStream();
    out.write(image, 0, at);
    out.write(extra);
    out.write(image, at, image.length - at);
    return out.toByteArray();
  }

  @Test
  void animatedPngRejectedAndPngMetadataRemoved() throws Exception {
    byte[] png = image("png", 300, 300);
    byte[] animation =
        insert(png, 33, pngChunk("acTL", ByteBuffer.allocate(8).putInt(2).putInt(0).array()));
    assertThrows(CatalogImageException.class, () -> normalizer.normalize(animation, "image/png"));
    var result =
        normalizer.normalize(
            insert(png, 33, pngChunk("tEXt", "GPS\0PRIVATE_LOCATION".getBytes())), "image/png");
    assertFalse(
        new String(result.bytes(), java.nio.charset.StandardCharsets.ISO_8859_1)
            .contains("PRIVATE_LOCATION"));
  }

  @Test
  void exifOrientationIsAppliedAndMetadataIsNotStored() throws Exception {
    byte[] tiff =
        ByteBuffer.allocate(26)
            .put((byte) 'M')
            .put((byte) 'M')
            .putShort((short) 42)
            .putInt(8)
            .putShort((short) 1)
            .putShort((short) 274)
            .putShort((short) 3)
            .putInt(1)
            .putShort((short) 6)
            .putShort((short) 0)
            .putInt(0)
            .array();
    var exif = new ByteArrayOutputStream();
    var data = new DataOutputStream(exif);
    data.writeShort(0xffe1);
    data.writeShort(tiff.length + 8);
    data.write(new byte[] {'E', 'x', 'i', 'f', 0, 0});
    data.write(tiff);
    var result =
        normalizer.normalize(insert(image("jpeg", 400, 300), 2, exif.toByteArray()), "image/jpeg");
    assertEquals(300, result.width());
    assertEquals(400, result.height());
    assertFalse(
        new String(result.bytes(), java.nio.charset.StandardCharsets.ISO_8859_1).contains("Exif"));
  }
}

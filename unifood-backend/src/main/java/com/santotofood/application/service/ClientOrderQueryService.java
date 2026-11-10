package com.santotofood.application.service;

import com.santotofood.application.exception.ClientOrderException;
import com.santotofood.application.model.ClientOrder;
import com.santotofood.application.model.ClientOrderHistory;
import com.santotofood.application.port.in.GetOwnCurrentOrderUseCase;
import com.santotofood.application.port.in.GetOwnOrderHistoryUseCase;
import com.santotofood.application.port.in.GetOwnOrderUseCase;
import com.santotofood.application.port.out.ClientOrderQueryPort;
import com.santotofood.application.port.out.ClientOrderQueryPort.CurrentTag;
import com.santotofood.application.port.out.ClientOrderQueryPort.HistoryRow;
import com.santotofood.application.port.out.ClientOrderQueryPort.Position;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * B16 (docs/decisiones.md §11): the client's current order, history and detail. Each read is one
 * read-only REPEATABLE READ transaction, so the tag and the order it describes come from the same
 * snapshot.
 */
@Service
public class ClientOrderQueryService
    implements GetOwnCurrentOrderUseCase, GetOwnOrderHistoryUseCase, GetOwnOrderUseCase {
  public static final int DEFAULT_HISTORY_LIMIT = 20;
  public static final int MAX_HISTORY_LIMIT = 50;
  static final int SUMMARY_PRODUCTS = 2;

  private static final Pattern LIMIT = Pattern.compile("[0-9]{1,2}");
  private static final int MAX_CURSOR_LENGTH = 96;

  private final ClientOrderQueryPort orders;
  private final TransactionTemplate read;

  public ClientOrderQueryService(ClientOrderQueryPort orders, PlatformTransactionManager manager) {
    this.orders = orders;
    this.read = new TransactionTemplate(manager);
    read.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    read.setReadOnly(true);
    read.setTimeout(15);
  }

  @Override
  public CurrentOrder getOwnCurrentOrder(UUID userId, String ifNoneMatch) {
    return inRead(
        () -> {
          var tag = orders.findCurrentTag(userId).orElseThrow(ClientOrderException::readForbidden);
          var etag = etag(tag);
          // A matching tag answers 304 before any order or item is read.
          if (matches(ifNoneMatch, etag)) return new CurrentOrder(etag, true, Optional.empty());
          if (tag.orderId() == null) return new CurrentOrder(etag, false, Optional.empty());
          var order =
              orders
                  .findOwnOrder(userId, tag.orderId())
                  .orElseThrow(() -> new IllegalStateException("Tagged order is not readable"));
          return new CurrentOrder(etag, false, Optional.of(order));
        });
  }

  @Override
  public ClientOrderHistory getOwnOrderHistory(UUID userId, String cursor, String limit) {
    return inRead(
        () -> {
          // As in B15, a missing client row is refused before the request is validated.
          var client = orders.findClient(userId).orElseThrow(ClientOrderException::readForbidden);
          var size = limit(limit);
          var after = Cursor.decode(cursor);
          // One extra row says whether there is a next page.
          var rows = new ArrayList<>(orders.findHistory(client, after, size + 1));
          var more = rows.size() > size;
          if (more) rows.subList(size, rows.size()).clear();
          var next = more ? Cursor.encode(rows.getLast()) : null;
          return new ClientOrderHistory(rows.stream().map(this::entry).toList(), next);
        });
  }

  @Override
  public ClientOrder getOwnOrder(UUID userId, UUID orderId) {
    return inRead(
        () -> {
          if (orders.findClient(userId).isEmpty()) throw ClientOrderException.readForbidden();
          return orders
              .findOwnOrder(userId, orderId)
              .orElseThrow(ClientOrderException::orderNotFound);
        });
  }

  private ClientOrderHistory.Entry entry(HistoryRow row) {
    return new ClientOrderHistory.Entry(
        row.id(),
        row.status(),
        row.total(),
        row.createdAt(),
        row.cafeteriaName(),
        row.units(),
        summary(row));
  }

  /** «2× Jugo natural, 1× Corriente y 2 más»: «más» counts the remaining distinct products. */
  static String summary(HistoryRow row) {
    var parts = new ArrayList<String>();
    for (int i = 0; i < row.firstNames().size() && i < SUMMARY_PRODUCTS; i++)
      parts.add(row.firstQuantities().get(i) + "× " + row.firstNames().get(i));
    var text = String.join(", ", parts);
    var rest = row.products() - parts.size();
    return rest > 0 ? text + " y " + rest + " más" : text;
  }

  private <T> T inRead(Supplier<T> body) {
    try {
      return read.execute(status -> body.get());
    } catch (TransientDataAccessException
        | DataAccessResourceFailureException
        | TransactionException unavailable) {
      throw ClientOrderException.readUnavailable();
    }
  }

  private static int limit(String value) {
    if (value == null || value.isEmpty()) return DEFAULT_HISTORY_LIMIT;
    if (!LIMIT.matcher(value).matches()) throw ClientOrderException.invalidRequest();
    var size = Integer.parseInt(value);
    if (size < 1 || size > MAX_HISTORY_LIMIT) throw ClientOrderException.invalidRequest();
    return size;
  }

  /**
   * Strong tag over what the client can see change: the order, its status, and {@code updated_at}
   * and {@code version}, which every UPDATE moves (001 and 008), reminders and rejections included.
   */
  static String etag(CurrentTag tag) {
    var source =
        tag.orderId() == null
            ? "order-v1|none"
            : "order-v1|"
                + tag.orderId()
                + "|"
                + tag.status()
                + "|"
                + ChronoUnit.MICROS.between(Instant.EPOCH, tag.updatedAt())
                + "|"
                + tag.version();
    try {
      var hash =
          MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
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

  /**
   * Opaque to the browser: base64url of the last row's {@code created_at} in microseconds and its
   * id. Anything that does not decode exactly is a 400; a well-formed forged one can only move
   * within the session client's own orders, because the query is filtered by that client.
   */
  static final class Cursor {
    private static final String PREFIX = "c1:";

    static String encode(HistoryRow row) {
      var text =
          PREFIX + ChronoUnit.MICROS.between(Instant.EPOCH, row.createdAt()) + ":" + row.id();
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    static Position decode(String cursor) {
      if (cursor == null || cursor.isEmpty()) return null;
      if (cursor.length() > MAX_CURSOR_LENGTH || !cursor.matches("[A-Za-z0-9_-]+"))
        throw ClientOrderException.invalidRequest();
      try {
        var text = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
        if (!text.startsWith(PREFIX)) throw ClientOrderException.invalidRequest();
        var parts = text.substring(PREFIX.length()).split(":", -1);
        if (parts.length != 2 || !parts[0].matches("-?[0-9]{1,19}"))
          throw ClientOrderException.invalidRequest();
        var id = UUID.fromString(parts[1]);
        // UUID.fromString accepts short forms; only the canonical one is ours.
        if (!id.toString().equals(parts[1])) throw ClientOrderException.invalidRequest();
        var micros = Long.parseLong(parts[0]);
        var position = new Position(Instant.EPOCH.plus(micros, ChronoUnit.MICROS), id);
        if (!encode(position).equals(cursor)) throw ClientOrderException.invalidRequest();
        return position;
      } catch (IllegalArgumentException | ArithmeticException | java.time.DateTimeException bad) {
        throw ClientOrderException.invalidRequest();
      }
    }

    private static String encode(Position position) {
      return encode(
          new HistoryRow(
              position.id(), null, null, position.createdAt(), null, 0, 0, List.of(), List.of()));
    }
  }
}

# ADMIN Product Images

## Architecture and access

Browser → Next BFF → Spring → private Supabase Storage. Only ADMIN is an image
audience in this phase. Storage credentials never enter Next, Auth clients or browser
responses. Spring derives the cafeteria from the verified JWT subject and fresh
business authorization: active user, exactly ADMIN and one assignment. Mutations
also require an active cafeteria and an owned product. Inactive cafeterias remain
readable. Foreign and absent products/images share 404 responses.

The bucket is private. No signed URLs are returned. Keys are immutable:
`cafeterias/{cafeteriaId}/products/{productId}/{assetId}.jpg|png`.
Only generated, validated keys reach the Storage adapter, with upsert disabled.
Legacy `image_url` data is preserved by migration and uploads; the managed pointer
takes precedence in ADMIN. Explicit removal clears the legacy reference too, but
never physically deletes legacy files. Commercial commands preserve both fields.

WORKER continues using its existing legacy local-image projection. Supporting
managed images there requires a WORKER-authorized read endpoint and projection;
do not send ADMIN-only references to WORKER. CLIENT's mock catalog stays separate.

## Provisioning and deployment

1. Apply migration 017 once after 016 with the authorized database owner. Do not
   run application binaries requiring the new columns before the migration.
2. In the correct environment's Supabase dashboard or administrative Storage API,
   create `product-images` as PRIVATE, limit files to 3 MiB and allow only
   `image/jpeg` and `image/png`. No browser upload policy is needed.
3. Review all effective `storage.objects` policies. Exclude this bucket from broad
   permissive policies; adding another policy does not cancel an existing allow.
   Verify anon/authenticated cannot list/read/upload/update/delete its objects.
4. Configure backend-only `SUPABASE_STORAGE_URL` (project URL + `/storage/v1`),
   `SUPABASE_STORAGE_SECRET_KEY`, `SUPABASE_PRODUCT_IMAGES_BUCKET` and timeouts.
   Use a server secret from the same environment/project, held in the secret manager.
   The adapter uses apikey for opaque secrets; legacy JWT credentials additionally
   use Authorization. Test the chosen credential against controlled Storage before
   release. A server secret has elevated project privileges, not bucket-only scope.
5. Verify the actual backend database role can access the two new tables and update
   `lunches.image_asset_id`. Browser roles have neither table nor column grants;
   RLS is enabled on both new tables without browser policies.
6. Keep `PRODUCT_IMAGES_CLEANUP_ENABLED=true` in at least one running Spring
   instance. Claims are leased so multiple instances may run cleanup safely.
7. Validate reverse proxy/hosting limits: multipart request 3,211,264 bytes, file
   3,145,728 bytes, BFF upload timeout 60 seconds, browser timeout 75 seconds,
   Storage connect timeout 5 seconds and operation timeout 20 seconds by default.
   JDBC phases have a 15-second timeout each. Servlet multipart spools to the
   runtime temp directory; provision bounded disk/concurrency and request admission
   limits in deployment. There is no configured hosting platform in the repository,
   so production body/time/disk limits are NOT verified by local tests.

Storage settings may both be empty: existing commercial operations remain usable,
but uploads/downloads requiring Storage return 503. Partial configuration fails
startup. HTTPS is required except loopback HTTP for controlled local integration.
Never commit real credentials, change remote configuration through automated tests,
or delete objects by SQL manipulation of `storage.objects`.

## Validation

Input: one JPEG or static PNG, at most 3 MiB, each dimension at most 4096,
shortest side at least 256, total at most 16 million pixels. MIME, signatures,
PNG chunk checksums/animation markers, decoder warnings and complete raster decode
are checked. At most four uploads and two decoders run concurrently per instance;
additional attempts receive a safe 503 without registering an operation.
Decode dimensions are checked
before pixel allocation. JPEG EXIF orientation is applied; a fresh raster is
reencoded with maximum side 1600 and at most 3 MiB output. Original EXIF/GPS,
comments and ancillary metadata are not copied. No original filename is stored.

## API

All endpoints use the verified identity and no-store responses. Mutations require
`Idempotency-Key` UUID. For recoverability when a response is lost, the operation ID
equals that key; identity and product ownership are still checked on every lookup.
Use a fresh random UUID for each distinct intent; never recycle keys across users.

- PUT `/api/admin/catalog/{id}/image`: multipart `file`, `expectedVersion` decimal
  string; attach or replace. No extra/repeated fields or tenant/Storage selectors.
- DELETE same route: JSON `{ "expectedVersion": "18" }`; detach transactionally.
- GET `/api/admin/catalog/{id}/image-operations/{operationId}`: actor-scoped recovery.
- GET `/api/admin/catalog/{id}/image/{imageId}`: only currently associated image;
  `private, no-store`, nosniff, same-origin resource policy. The backend verifies
  downloaded size/hash against validated metadata before returning the bytes.

Operation response: `operationId`, `state` (PROCESSING/APPLIED/REJECTED),
`appliedVersion` string or null, `failureStatus`/`failureCode` or null, and full
current `product`. APPLIED is confirmed success; 202 means processing, not success.
GET recovery returns 200 with the operation state. Replaying a rejected mutation
returns its recorded error status. The current product may have a newer version
than appliedVersion; clients must never restore an older product representation.

Errors: 400 invalid request, 401 unauthenticated, 403 business denial/inactive
cafeteria, 404 inaccessible resource, 409 stale version/idempotency conflict,
413 size, 415 unsupported format, 422 invalid image, 503 temporary dependency
failure with Retry-After 5, and sanitized 500. Image codes have prefix
`ADMIN_CATALOG_IMAGE_`; existing business denial/stale codes remain unchanged.
The BFF bounds request and response streams, blocks redirects, verifies Auth,
enforces same-origin mutations and forwards only fixed destinations/headers.

## Transactions, idempotency and recovery

No Storage call or image processing holds PostgreSQL business row locks. A short
admission precedes decoding, a second transaction registers the candidate/operation,
Storage receives the immutable normalized object, and a final transaction rechecks
admission and expectedVersion before swapping the association. Existing lock order
starts with authorization guard, cafeteria and product. Every successful association
or detach increments the product revision once via 016; journal/cleanup updates do
not increment it. Replays do not repeat effects. Concurrent conflicting replacements
have one winner; rejected candidates never replace the previous confirmed image.

The operation fingerprint includes original bytes, MIME, kind and expectedVersion.
Repeated matching keys return recorded state; changed intent returns 409. Processing
leases last five minutes. An expired operation is rejected when checked or cleaned;
its candidate is not reused. A definite failure permits a new explicit intent after
review. A missing recovery record can be retried with the SAME key and same payload.
No automatic retry of product creation or Storage mutation occurs.

PostgreSQL and Storage are not atomically committed. If a commit acknowledgement is
lost, do not reject/delete the candidate on that assumption: the durable operation
and current pointer settle the outcome. Database outages keep the candidate known
and pending reconciliation. Cleanup never automatically completes a business mutation.

Replacement/detach marks old managed assets RETIRED in the association transaction.
Cleanup runs every ten minutes, at most twenty assets per pass. Grace is 24 hours.
It locks the product and asset, excludes current references and valid operations,
then marks DELETING with a five-minute lease before network I/O. Retired/deleting
assets cannot be attached. Failed deletion is retried after one hour, with attempt
count persisted; 404 means already deleted. Rows/operations are retained for recovery;
no automatic retention/deletion of business or historical data is introduced.

Monitor pending cleanup age, attempts and repeated warnings. Logs contain operation
or asset UUIDs and stage only, never credentials, file bytes, original names,
signed URLs or raw Storage errors. Investigate missing Storage objects through the
known asset journal; never sweep unrelated bucket objects or legacy references.

## Editor lifecycle and tests

Create commercial product first, then upload using the confirmed ID/version. A failed
image never retries creation. Editing serializes commercial changes before images.
Selection/preview/removal participates in unsaved-draft handling; pending operations
disable duplicate submit/close. Uncertain outcomes preserve the preview and offer
explicit operation lookup, including same-intent retry if no record exists.

Local tests cover real PostgreSQL migrations, constraints, authorization/CAS,
concurrent replacement and injected dependency/commit failures. Storage port mocks
and a loopback HTTP server cover transport only. Browser tests use a fake Spring
provider and synthetic PNG, not Supabase Storage. Release additionally requires a
controlled Storage project to verify real private policies, selected credential,
physical upload/download/delete and hosting limits. No production integration is
claimed from mock/local coverage.

API references: [Storage HTTP routes](https://supabase.github.io/storage/) and
[server API keys](https://supabase.com/docs/guides/getting-started/api-keys).

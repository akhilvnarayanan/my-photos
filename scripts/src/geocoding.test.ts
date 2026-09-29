import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeocodeResult,
  normalizeCoordinateKey,
  resolveOfflinePlace,
} from "../../artifacts/api-server/src/lib/geocoding";

test("normalizes coordinates to a stable precision-aware cache key", () => {
  assert.equal(normalizeCoordinateKey(1.234567, 103.987654, 5), "1.23457,103.98765");
  assert.equal(normalizeCoordinateKey("1.234567", "103.987654", 4), "1.2346,103.9877");
});

test("known offline coordinates map to place metadata with provider and status", () => {
  const result = resolveOfflinePlace(1.3521, 103.8198);
  assert.ok(result);
  assert.equal(result?.country, "Singapore");
  assert.equal(result?.city, "Singapore");
  assert.equal(result?.provider, "offline-local");
  assert.equal(result?.status, "completed");
});

test("unknown coordinates are preserved as unresolved rather than invented", () => {
  const result = resolveOfflinePlace(0.1, 0.1);
  assert.equal(result, null);
});

test("geocode result serialization keeps provider metadata and a stable payload", () => {
  const value = buildGeocodeResult({
    country: "India",
    state: "Kerala",
    city: "Kozhikode",
    locality: "Punggol",
    formattedName: "Kozhikode, Kerala",
    latitude: 11.2588,
    longitude: 75.7804,
    provider: "offline-local",
    providerVersion: "v1",
  });

  assert.equal(value.status, "completed");
  assert.equal(value.provider, "offline-local");
  assert.match(value.formattedName ?? "", /Kozhikode/);
  assert.equal(value.providerVersion, "v1");
});

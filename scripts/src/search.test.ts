import assert from "node:assert/strict";
import test from "node:test";
import { appendUniqueById, cursorForPhoto, escapeLike, parsePhotoCursor } from "../../artifacts/api-server/src/lib/search";

test("escapes SQL LIKE wildcards while preserving ordinary search text", () => {
  assert.equal(escapeLike("board_50%"), "board\\_50\\%");
});

test("photo cursors round-trip stable date and id ordering values", () => {
  const date = new Date("2024-01-02T03:04:05.000Z");
  assert.deepEqual(parsePhotoCursor(cursorForPhoto(date, "photo-2")), { captureDate: date, id: "photo-2" });
  assert.equal(parsePhotoCursor("invalid"), null);
});

test("page accumulation rejects duplicate photo ids", () => {
  assert.deepEqual(appendUniqueById([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]), [
    { id: "a" },
    { id: "b" },
    { id: "c" },
  ]);
});

test("a newer search result remains authoritative when an older request resolves later", async () => {
  let current = "";
  const apply = (term: string, result: string[]) => {
    if (term === current) return result;
    return [];
  };
  current = "certificate";
  const newer = apply("certificate", ["certificate.jpg"]);
  const older = apply("board", ["board.jpg"]);
  assert.deepEqual(newer, ["certificate.jpg"]);
  assert.deepEqual(older, []);
});
import assert from "node:assert/strict";
/** Independent central-directory reader used by tests of the STORE-only archive. */
export function readExportZip(input: Uint8Array) {
  const data = Buffer.from(input),
    eocd = data.length - 22;
  assert.equal(data.readUInt32LE(eocd), 0x06054b50);
  const count = data.readUInt16LE(eocd + 10),
    start = data.readUInt32LE(eocd + 16);
  assert.equal(start + data.readUInt32LE(eocd + 12), eocd);
  const files: Record<string, string> = {};
  let pos = start;
  for (let i = 0; i < count; i++) {
    assert.equal(data.readUInt32LE(pos), 0x02014b50);
    assert.equal(data.readUInt16LE(pos + 10), 0);
    assert.equal(data.readUInt16LE(pos + 8), 0x800);
    const n = data.readUInt16LE(pos + 28),
      extra = data.readUInt16LE(pos + 30),
      comment = data.readUInt16LE(pos + 32);
    const size = data.readUInt32LE(pos + 24),
      local = data.readUInt32LE(pos + 42),
      name = data.subarray(pos + 46, pos + 46 + n).toString("utf8");
    assert.equal(data.readUInt32LE(local), 0x04034b50);
    assert.equal(data.readUInt32LE(local + 14), data.readUInt32LE(pos + 16));
    assert.equal(data.readUInt32LE(local + 22), size);
    const begin =
      local +
      30 +
      data.readUInt16LE(local + 26) +
      data.readUInt16LE(local + 28);
    files[name] = data.subarray(begin, begin + size).toString("utf8");
    pos += 46 + n + extra + comment;
  }
  assert.equal(pos, eocd);
  return files;
}

const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export type ArchiveFile = { name: string; data: string | Uint8Array };

/** Small UTF-8, STORE-only ZIP32 writer. No paths, compression, or ZIP64. */
export function writeZip(
  files: ArchiveFile[],
  at = new Date(),
): Uint8Array<ArrayBuffer> {
  if (files.length > 200) throw new Error("Too many archive files");
  const names = new Set<string>();
  const entries = files.map((file) => {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(file.name) ||
      names.has(file.name.toLowerCase())
    )
      throw new Error("Unsafe or duplicate archive name");
    names.add(file.name.toLowerCase());
    return {
      name: encoder.encode(file.name),
      data:
        typeof file.data === "string" ? encoder.encode(file.data) : file.data,
    };
  });
  const size = entries.reduce(
    (n, e) => n + 30 + 46 + e.name.length * 2 + e.data.length,
    22,
  );
  if (size > 20 * 1024 * 1024) throw new Error("Archive size limit exceeded");
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const year = Math.min(2107, Math.max(1980, at.getUTCFullYear()));
  const date =
    ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate();
  const time =
    (at.getUTCHours() << 11) |
    (at.getUTCMinutes() << 5) |
    (at.getUTCSeconds() >>> 1);
  let pos = 0;
  const central: {
    offset: number;
    crc: number;
    entry: (typeof entries)[number];
  }[] = [];
  for (const entry of entries) {
    const offset = pos,
      crc = crc32(entry.data);
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 0x800, true);
    view.setUint16(pos + 10, time, true);
    view.setUint16(pos + 12, date, true);
    view.setUint32(pos + 14, crc, true);
    view.setUint32(pos + 18, entry.data.length, true);
    view.setUint32(pos + 22, entry.data.length, true);
    view.setUint16(pos + 26, entry.name.length, true);
    out.set(entry.name, pos + 30);
    out.set(entry.data, pos + 30 + entry.name.length);
    pos += 30 + entry.name.length + entry.data.length;
    central.push({ offset, crc, entry });
  }
  const start = pos;
  for (const { offset, crc, entry } of central) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x800, true);
    view.setUint16(pos + 12, time, true);
    view.setUint16(pos + 14, date, true);
    view.setUint32(pos + 16, crc, true);
    view.setUint32(pos + 20, entry.data.length, true);
    view.setUint32(pos + 24, entry.data.length, true);
    view.setUint16(pos + 28, entry.name.length, true);
    view.setUint32(pos + 42, offset, true);
    out.set(entry.name, pos + 46);
    pos += 46 + entry.name.length;
  }
  const centralSize = pos - start;
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, centralSize, true);
  view.setUint32(pos + 16, start, true);
  return out;
}

import { deflateSync } from 'node:zlib';

/** Icona originale: scontrino e pompa, generata senza servizi o font esterni. */
export function appIcon(size: number): Buffer {
  const ink = [41, 46, 40];
  const paper = [250, 247, 237];
  const pixels = Buffer.alloc((size * 3 + 1) * size);
  const inside = (x: number, y: number, left: number, top: number, right: number, bottom: number) =>
    x >= left && x < right && y >= top && y < bottom;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = (col + 0.5) * 512 / size;
      const y = (row + 0.5) * 512 / size;
      const edge = Math.abs((x - 112) % 32 - 16) / 2;
      let color = inside(x, y, 112, 96 + edge, 400, 416 - edge) ? paper : ink;
      if (inside(x, y, 176, 160, 272, 280)
        || inside(x, y, 160, 280, 288, 296)
        || inside(x, y, 272, 216, 296, 232)
        || inside(x, y, 288, 192, 304, 272)
        || inside(x, y, 288, 264, 328, 280)
        || inside(x, y, 312, 184, 328, 272)
        || inside(x, y, 296, 176, 320, 192)
        || inside(x, y, 160, 328, 352, 340)
        || inside(x, y, 160, 356, 304, 368)) color = ink;
      if (inside(x, y, 192, 176, 256, 216)) color = paper;
      const offset = row * (size * 3 + 1) + 1 + col * 3;
      pixels.set(color, offset);
    }
  }
  function chunk(type: string, data: Buffer) {
    const name = Buffer.from(type);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([name, data])) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, name, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2; // RGB opaco, adatto anche ad apple-touch-icon.
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

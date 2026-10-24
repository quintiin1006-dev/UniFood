import { deflateSync } from "node:zlib";
function chunk(type, data) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  let value = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  crc.writeUInt32BE((value ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, crc]);
}
export function productImageFixture() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(300);
  header.writeUInt32BE(300, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((300 * 3 + 1) * 300);
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 300; x++) {
      const i = y * 901 + 1 + x * 3;
      pixels[i] = 34;
      pixels[i + 1] = 90;
      pixels[i + 2] = 160;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

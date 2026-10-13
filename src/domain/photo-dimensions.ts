/**
 * Inspect JPEG/PNG/WebP headers without decoding full-resolution pixels.
 * This prevents oversized camera images exhausting mobile browser memory.
 * Unrecognized/HEIC images must use the decoder's restricted-resize path.
 */
export type PhotoDimensions = { width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) =>
  (b[i] * 16777216) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const valid = (width: number, height: number): PhotoDimensions | null =>
  Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? { width, height } : null;

export function imageHeaderDimensions(b: Uint8Array): PhotoDimensions | null {
  if (b.length >= 24 && b[0] === 137 && b[1] === 80 &&
      b[2] === 78 && b[3] === 71 && b[12] === 73 &&
      b[13] === 72 && b[14] === 68 && b[15] === 82) {
    return valid(u32be(b, 16), u32be(b, 20));
  }

  // JPEG dimensions appear in a Start Of Frame marker.
  if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    let offset = 2;
    while (offset + 3 < b.length) {
      if (b[offset] !== 255) { offset++; continue; }
      let marker = b[++offset];
      while (marker === 255 && offset < b.length - 1) marker = b[++offset];
      offset++;
      if (marker === 217 || marker === 218) break;
      if (marker === 216 || marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > b.length) break;
      const length = u16be(b, offset);
      if (length < 2 || offset + length > b.length) break;
      if ((marker >= 192 && marker <= 195) ||
          (marker >= 197 && marker <= 199) ||
          (marker >= 201 && marker <= 203) ||
          (marker >= 205 && marker <= 207)) {
        if (length < 7) return null;
        return valid(u16be(b, offset + 5), u16be(b, offset + 3));
      }
      offset += length;
    }
    return null;
  }

  // WebP extended, lossy and lossless formats.
  if (b.length >= 30 &&
      String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.subarray(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...b.subarray(12, 16));
    if (kind === "VP8X") return valid(
      1 + b[24] + (b[25] << 8) + (b[26] << 16),
      1 + b[27] + (b[28] << 8) + (b[29] << 16),
    );
    if (kind === "VP8L" && b[20] === 47) return valid(
      1 + b[21] + ((b[22] & 63) << 8),
      1 + ((b[22] >> 6) & 3) + (b[23] << 2) + ((b[24] & 15) << 10),
    );
    if (kind === "VP8 " && b[23] === 157 && b[24] === 1 && b[25] === 42) return valid(
      (b[26] | (b[27] << 8)) & 16383,
      (b[28] | (b[29] << 8)) & 16383,
    );
  }
  return null;
}

export async function readPhotoDimensions(file: File): Promise<PhotoDimensions | null> {
  const header = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  return imageHeaderDimensions(header);
}

import { create } from "qrcode";

/** Quiet zone the QR standard asks for, in modules. */
export const QR_QUIET_ZONE = 4;

/** Computes the QR matrix for `value` locally and returns it as one SVG path. */
export function qrSvgPath(value: string): { size: number; path: string } {
  const { modules } = create(value, { errorCorrectionLevel: "M" });
  let path = "";
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size: modules.size, path };
}

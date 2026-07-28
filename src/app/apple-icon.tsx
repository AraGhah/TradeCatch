import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon — TradeCatch checkmark (not the Next.js default). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0C141E",
          borderRadius: 36,
        }}
      >
        <div
          style={{
            width: 88,
            height: 50,
            borderLeft: "16px solid #E4762B",
            borderBottom: "16px solid #E4762B",
            transform: "rotate(-45deg) translateY(-10px)",
          }}
        />
      </div>
    ),
    size,
  );
}

import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** App icon / favicon — TradeCatch checkmark mark (not the Next.js default). */
export default function Icon() {
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
          borderRadius: 8,
        }}
      >
        <div
          style={{
            width: 16,
            height: 9,
            borderLeft: "3px solid #E4762B",
            borderBottom: "3px solid #E4762B",
            transform: "rotate(-45deg) translateY(-2px)",
          }}
        />
      </div>
    ),
    size,
  );
}

import { ImageResponse } from "next/og";

export const alt = "Lidomap — клиенты, которым нужны ваши услуги";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "linear-gradient(135deg, #10131a 0%, #191d28 55%, #162d28 100%)",
        color: "#f7f6f3",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: "72px",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", maxWidth: "980px", width: "100%" }}>
        <div style={{ alignItems: "center", display: "flex", fontSize: 34, fontWeight: 700, gap: 16 }}>
          <div style={{ background: "#59d7b1", borderRadius: 18, height: 54, width: 54 }} />
          Lidomap
        </div>
        <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: "-3px", lineHeight: 1.05, marginTop: 68 }}>
          Клиенты, которым нужны ваши услуги
        </div>
        <div style={{ color: "#b9c0cc", fontSize: 30, lineHeight: 1.35, marginTop: 34 }}>
          Каталог заведений России, оценка лида, проверка сайта и готовое первое сообщение
        </div>
      </div>
    </div>,
    size,
  );
}

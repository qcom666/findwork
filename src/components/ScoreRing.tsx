import type { CSSProperties } from "react";

/** Кольцо с оценкой лида: цвет зависит от значения, заполнение показывает долю из 100. */
export function ScoreRing({ score, size = "2.75rem" }: { score: number; size?: string }) {
  const tone = score >= 70 ? "ring-good" : score >= 45 ? "ring-warn" : "";
  return (
    <span className={`ring ${tone}`} style={{ "--p": score, "--size": size } as CSSProperties} title="Оценка лида, 0–100">
      <span>{score}</span>
    </span>
  );
}

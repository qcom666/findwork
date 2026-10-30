"use client";

import { useEffect, useRef } from "react";
import { RADAR_HOT, RADAR_RADIUS, RADAR_REST } from "./radar-points";

/**
 * Живой фон первого экрана главной: луч радара обходит настоящие заведения Москвы (scripts/radar-points.mjs),
 * и те, у кого нет своего сайта, вспыхивают зелёным. Центр радара под элементом [data-radar-center] того же блока.
 * Холст лежит позади страницы от её верха до низа блока и плавно уходит в фон (.radar-bg в globals.css).
 * Пока блок не виден, не рисует; при «уменьшить движение» показывает один неподвижный кадр. Цвета берёт из темы сайта.
 */

const TAU = Math.PI * 2;
const OMEGA = TAU / 8; // оборот луча за 8 секунд
const WEDGE = 0.9; // ширина следа за лучом, рад
const FADE_HOT = 4.5; // сколько секунд гаснет заведение без сайта
const FADE_REST = 2.2; // и остальные
const RING = 250; // шаг колец: 2,5 км в единицах точек (десятки метров)
const TAIL = 160; // насколько холст заходит ниже блока, чтобы успеть раствориться

type Pt = { x: number; y: number; ang: number };

function points(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1], ang: Math.atan2(flat[i + 1], flat[i]) });
  return out;
}

/** "#4338ca" → "67 56 202" для rgb(… / альфа). */
function rgb(value: string, fallback: string): string {
  const h = value.trim().replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return fallback;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(" ");
}

/** Запускает радар на холсте и возвращает остановку. section: блок, под которым лежит холст. */
function start(canvas: HTMLCanvasElement, section: HTMLElement, ctx: CanvasRenderingContext2D): () => void {
  const hot = points(RADAR_HOT);
  const rest = points(RADAR_REST);
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const darkScheme = matchMedia("(prefers-color-scheme: dark)");
  const base = document.createElement("canvas"); // кольца и тусклые точки: рисуются один раз, а не каждый кадр
  let w = 0, h = 0, cx = 0, cy = 0, scale = 1, dpr = 1;
  let accent = "67 56 202", good = "13 116 83", dark = false;
  let visible = true, frame = 0;
  let veil: CanvasGradient | null = null; // приглушает радар под колонкой с текстом

  function readColors() {
    const css = getComputedStyle(document.documentElement);
    accent = rgb(css.getPropertyValue("--accent"), accent);
    good = rgb(css.getPropertyValue("--good"), good);
    dark = css.getPropertyValue("color-scheme").includes("dark");
  }

  function paintBase() {
    const b = base.getContext("2d");
    if (!b) return;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.clearRect(0, 0, w, h);
    b.lineWidth = 1;
    b.strokeStyle = `rgb(${accent} / 0.14)`;
    for (let r = RING * scale; r < RADAR_RADIUS * scale; r += RING * scale) {
      b.beginPath();
      b.arc(cx, cy, r, 0, TAU);
      b.stroke();
    }
    b.strokeStyle = `rgb(${accent} / 0.06)`;
    b.beginPath();
    b.moveTo(0, cy);
    b.lineTo(w, cy);
    b.moveTo(cx, 0);
    b.lineTo(cx, h);
    b.stroke();
    b.fillStyle = `rgb(${accent} / ${dark ? 0.22 : 0.2})`;
    for (const p of [...hot, ...rest]) b.fillRect(cx + p.x * scale - 0.8, cy + p.y * scale - 0.8, 1.6, 1.6);
  }

  function draw(t: number) {
    const a = still.matches ? -0.7 : ((t / 1000) * OMEGA) % TAU;
    const R = RADAR_RADIUS * scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(base, 0, 0, w, h);

    // След за лучом: от прозрачного к цвету акцента у самого луча
    if ("createConicGradient" in ctx) {
      const g = ctx.createConicGradient(a - WEDGE, cx, cy);
      const k = WEDGE / TAU;
      g.addColorStop(0, `rgb(${accent} / 0)`);
      g.addColorStop(k, `rgb(${accent} / ${dark ? 0.16 : 0.14})`);
      g.addColorStop(k + 0.001, `rgb(${accent} / 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a - WEDGE, a);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = `rgb(${accent} / ${dark ? 0.45 : 0.4})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();

    // Заведения, мимо которых недавно прошёл луч. Возраст считается из угла, так что состояния у точек нет.
    const age = (p: Pt) => ((((a - p.ang) % TAU) + TAU) % TAU) / OMEGA;
    ctx.fillStyle = `rgb(${accent})`;
    for (const p of rest) {
      const s = age(p);
      if (s >= FADE_REST) continue;
      ctx.globalAlpha = 0.55 * (1 - s / FADE_REST);
      ctx.fillRect(cx + p.x * scale - 1.2, cy + p.y * scale - 1.2, 2.4, 2.4);
    }
    ctx.fillStyle = ctx.strokeStyle = `rgb(${good})`;
    for (const p of hot) {
      const s = age(p);
      if (s >= FADE_HOT) continue;
      const x = cx + p.x * scale, y = cy + p.y * scale;
      ctx.globalAlpha = 1 - s / FADE_HOT;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, TAU);
      ctx.fill();
      if (s < 1.2) {
        ctx.globalAlpha = 0.4 * (1 - s / 1.2);
        ctx.beginPath();
        ctx.arc(x, y, 3 + s * 8, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (veil) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function layout() {
    const host = (canvas.offsetParent ?? document.body).getBoundingClientRect();
    const box = section.getBoundingClientRect();
    const anchor = (section.querySelector("[data-radar-center]") ?? section).getBoundingClientRect();
    w = canvas.clientWidth;
    h = Math.round(box.bottom - host.top + TAIL);
    canvas.style.height = `${h}px`;
    // В две колонки (lg) центр под карточкой справа; в одну карточка уходит вниз, и радар встаёт в правый верх первого экрана
    const wide = w >= 1024;
    cx = wide ? anchor.left + anchor.width / 2 - host.left : w * 0.8;
    cy = wide ? anchor.top + anchor.height / 2 - host.top : Math.min(320, h / 3);
    veil = null;
    if (wide) {
      veil = ctx.createLinearGradient(0, 0, w, 0);
      veil.addColorStop(0.3, "rgb(0 0 0 / 0.55)");
      veil.addColorStop(0.62, "rgb(0 0 0 / 0)");
    }
    const reach = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
    scale = Math.min(Math.max(reach, 600), 1100) / RADAR_RADIUS;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [canvas, base]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    readColors();
    paintBase();
    draw(performance.now());
    canvas.dataset.ready = "";
  }

  function tick(t: number) {
    draw(t);
    frame = requestAnimationFrame(tick);
  }

  function sync() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (visible && !still.matches) frame = requestAnimationFrame(tick);
    else draw(performance.now());
  }

  function recolor() {
    readColors();
    paintBase();
    draw(performance.now());
  }

  layout();
  sync();
  const resize = new ResizeObserver(() => layout());
  resize.observe(section);
  resize.observe(document.body);
  const seen = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    sync();
  });
  seen.observe(canvas);
  const theme = new MutationObserver(recolor);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  darkScheme.addEventListener("change", recolor);
  still.addEventListener("change", sync);

  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    seen.disconnect();
    theme.disconnect();
    darkScheme.removeEventListener("change", recolor);
    still.removeEventListener("change", sync);
  };
}

export function RadarBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const section = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (canvas && section && ctx) return start(canvas, section, ctx);
  }, []);

  return <canvas ref={ref} className="radar-bg" aria-hidden="true" />;
}

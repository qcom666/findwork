import Link from "next/link";
import type { Block } from "@/content/types";

/** Ссылки [текст](/путь) и **жирный** внутри абзацев. Внешние ссылки открываются в новой вкладке без передачи реферера. */
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[4]) {
      parts.push(<code key={i++} className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.9em]">{m[4]}</code>);
    } else if (m[3]) {
      parts.push(<strong key={i++} className="font-semibold text-ink">{m[3]}</strong>);
    } else if (m[2].startsWith("/")) {
      parts.push(<Link key={i++} href={m[2]} className="text-accent underline-offset-2 hover:underline">{m[1]}</Link>);
    } else {
      parts.push(<a key={i++} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">{m[1]}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-5 text-[1.0625rem] leading-[1.75] text-ink/90">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h2":
            return <h2 key={i} className="!mt-10 text-2xl font-bold tracking-tight text-ink">{b.text}</h2>;
          case "h3":
            return <h3 key={i} className="!mt-6 text-lg font-semibold text-ink">{b.text}</h3>;
          case "p":
            return <p key={i}><Inline text={b.text} /></p>;
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-2 pl-6 marker:text-muted">
                {b.items.map((x, j) => <li key={j}><Inline text={x} /></li>)}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-2 pl-6 marker:font-semibold marker:text-muted">
                {b.items.map((x, j) => <li key={j}><Inline text={x} /></li>)}
              </ol>
            );
          case "quote":
            return (
              <figure key={i} className="rounded-xl border border-line bg-surface-2 px-5 py-4">
                <blockquote className="whitespace-pre-line text-[1rem] leading-relaxed text-ink">{b.text}</blockquote>
                {b.note && <figcaption className="mt-2 text-sm text-muted">{b.note}</figcaption>}
              </figure>
            );
          case "callout":
            return (
              <aside key={i} className="rounded-xl border border-accent/30 bg-accent-soft px-5 py-4">
                <p className="font-semibold text-accent">{b.title}</p>
                <p className="mt-1 text-[1rem] leading-relaxed text-ink/90"><Inline text={b.text} /></p>
              </aside>
            );
        }
      })}
    </div>
  );
}

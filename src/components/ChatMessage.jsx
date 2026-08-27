import Markdown from 'react-markdown';

/*
 * B.L.A.Y.N.E answers in Markdown, so the assistant side renders it. The
 * component map keeps the output inside the site's type scale instead of
 * inheriting browser defaults.
 */
const MD = {
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h3 className="mt-5 mb-2 text-base font-normal text-platinum first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-5 mb-2 text-base font-normal text-platinum first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-4 mb-2 text-sm font-normal text-platinum first:mt-0">{children}</h4>
  ),
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-platinum">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} className="text-jordy underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-platinum/8 px-1.5 py-0.5 text-[0.9em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-xl bg-platinum/10 p-4 text-[0.85em]">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-jordy/40 pl-4 text-platinum/70">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-jordy/25 px-3 py-2 font-normal text-platinum">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-jordy/10 px-3 py-2 align-top">{children}</td>
  ),
  hr: () => <hr className="my-5 border-jordy/15" />,
};

export default function ChatMessage({ role, topic, content, pending }) {
  if (role === 'user') {
    return (
      <li className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-jordy/25 px-4 py-2.5">
          {topic && (
            <span className="mb-1 block text-[11px] tracking-[0.08em] text-platinum/60 uppercase">
              {topic}
            </span>
          )}
          <p className="m-0 text-sm leading-relaxed whitespace-pre-wrap text-platinum">
            {content}
          </p>
        </div>
      </li>
    );
  }

  return (
    <li className="flex justify-start">
      <div className="max-w-[92%] text-sm leading-relaxed text-platinum/90">
        <span className="mb-2 block text-[11px] tracking-[0.08em] text-jordy/70 uppercase">
          B.L.A.Y.N.E
        </span>
        {content ? (
          <Markdown components={MD}>{content}</Markdown>
        ) : (
          <span className="flex items-center gap-2 text-platinum/50">
            <span className="h-1.5 w-1.5 rounded-full bg-jordy motion-safe:animate-pulse" />
            Thinking…
          </span>
        )}
        {pending && content && (
          <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-jordy motion-safe:animate-pulse" />
        )}
      </div>
    </li>
  );
}

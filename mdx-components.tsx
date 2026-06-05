import type { MDXComponents } from "mdx/types";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }) => (
      <h1 className="mb-6 text-2xl font-semibold text-foreground">{children}</h1>
    ),
    h2: ({ children, id }) => (
      <h2
        id={id}
        className="mb-3 mt-8 scroll-mt-24 text-lg font-semibold text-foreground first:mt-0"
      >
        {children}
      </h2>
    ),
    h3: ({ children, id }) => (
      <h3 id={id} className="mb-2 mt-5 scroll-mt-24 text-sm font-semibold text-foreground">
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="mb-3 text-sm leading-relaxed text-foreground/80">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-foreground/80">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-foreground/80">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    code: ({ children }) => (
      <code className="rounded-lg bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="mb-3 overflow-x-auto rounded-2xl bg-secondary p-4 font-mono text-xs text-foreground">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mb-3 rounded-2xl border-l-4 border-primary/40 bg-primary/5 py-2 pl-4 pr-3 text-sm text-foreground/70">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-6 border-border/40" />,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    table: ({ children }) => (
      <div className="mb-4 overflow-x-auto rounded-2xl border border-border/40">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-secondary/70">{children}</thead>,
    th: ({ children }) => (
      <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border-t border-border/40 px-4 py-2.5 text-foreground/80">{children}</td>
    ),
    ...components,
  };
}

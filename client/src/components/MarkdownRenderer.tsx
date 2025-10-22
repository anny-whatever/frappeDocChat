import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isUserMessage?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  isUserMessage = false,
}) => {
  return (
    <div className={cn('markdown-content', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={{
          // Headings
          h1: ({ children }) => (
            <h1 className="text-lg font-bold mb-2 text-foreground">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold mb-2 text-foreground">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold mb-1 text-foreground">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-medium mb-1 text-foreground">{children}</h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-xs font-medium mb-1 text-foreground">{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-xs font-medium mb-1 text-muted-foreground">{children}</h6>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 leading-relaxed text-sm">{children}</p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="list-disc list-outside mb-2 space-y-1 text-sm pl-6">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside mb-2 space-y-1 text-sm pl-6">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed pl-2">{children}</li>
          ),

          // Code blocks
          code: ({ className, children, ...props }: any) => {
            const inline = !className;
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            
            if (inline) {
              return (
                <code
                  className={cn(
                    'px-1.5 py-0.5 rounded text-xs font-mono',
                    isUserMessage 
                      ? 'bg-primary-foreground/20 text-primary-foreground' 
                      : 'bg-muted text-muted-foreground'
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <div className="my-2">
                {language && (
                  <div className={cn(
                    'px-3 py-1 text-xs font-medium rounded-t-md border-b',
                    isUserMessage 
                      ? 'bg-primary-foreground/10 text-primary-foreground border-primary-foreground/20' 
                      : 'bg-muted text-muted-foreground border-border'
                  )}>
                    {language}
                  </div>
                )}
                <pre
                  className={cn(
                    'p-3 overflow-x-auto text-xs font-mono',
                    language ? 'rounded-b-md' : 'rounded-md',
                    isUserMessage 
                      ? 'bg-primary-foreground/10 text-primary-foreground' 
                      : 'bg-muted text-foreground'
                  )}
                >
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className={cn(
              'border-l-4 pl-4 my-2 italic',
              isUserMessage 
                ? 'border-primary-foreground/30 text-primary-foreground/90' 
                : 'border-muted-foreground/30 text-muted-foreground'
            )}>
              {children}
            </blockquote>
          ),

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'underline hover:no-underline transition-colors',
                isUserMessage 
                  ? 'text-primary-foreground hover:text-primary-foreground/80' 
                  : 'text-primary hover:text-primary/80'
              )}
            >
              {children}
            </a>
          ),

          // Tables
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse border border-border text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className={cn(
              isUserMessage 
                ? 'bg-primary-foreground/10' 
                : 'bg-muted'
            )}>
              {children}
            </thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-border">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1">{children}</td>
          ),

          // Horizontal rule
          hr: () => (
            <hr className={cn(
              'my-3 border-0 h-px',
              isUserMessage 
                ? 'bg-primary-foreground/20' 
                : 'bg-border'
            )} />
          ),

          // Strong and emphasis
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic">{children}</em>
          ),

          // Strikethrough (from remark-gfm)
          del: ({ children }) => (
            <del className="line-through opacity-75">{children}</del>
          ),

          // Task lists (from remark-gfm)
          input: ({ type, checked, ...props }) => {
            if (type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  disabled
                  className="mr-2 accent-primary"
                  {...props}
                />
              );
            }
            return <input type={type} {...props} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
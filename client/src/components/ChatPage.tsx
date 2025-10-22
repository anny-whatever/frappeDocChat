import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Database, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// card imports removed (unused)
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChat, useHealth, useStats } from "../hooks/useApi";
import type { Message } from "../services/api";
import { apiService } from "../services/api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolCalls?: any[];
}

export function ChatPage() {
  const [inputMessage, setInputMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const chatMutation = useChat();
  const { data: health } = useHealth();
  const { data: stats } = useStats();

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const streamAbortRef = useRef<{ abort: () => void } | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || chatMutation.isPending || isStreaming) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: inputMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");

    // Prepare assistant placeholder for streaming
    setIsStreaming(true);
    let assistantIndex = -1;
    let isFirstDelta = true;
    setMessages((prev) => {
      assistantIndex = prev.length;
      return [
        ...prev,
        {
          role: "assistant",
          content: "...", // show typing dots to avoid empty bubble
          timestamp: new Date(),
        },
      ];
    });

    const onDelta = (delta: string) => {
      console.log("onDelta called with:", delta, "isFirstDelta:", isFirstDelta);
      setMessages((prev) => {
        const next = [...prev];
        const idx = assistantIndex >= 0 ? assistantIndex : next.length - 1;
        console.log("Current content before update:", next[idx]?.content);
        next[idx] = {
          ...next[idx],
          content: isFirstDelta ? delta : (next[idx]?.content || "") + delta,
        } as ChatMessage;
        console.log("New content after update:", next[idx]?.content);
        isFirstDelta = false;
        return next;
      });
    };

    const onMeta = (meta: { toolCalls?: any[] }) => {
      setMessages((prev) => {
        const next = [...prev];
        const idx = assistantIndex >= 0 ? assistantIndex : next.length - 1;
        next[idx] = {
          ...next[idx],
          toolCalls: meta.toolCalls || [],
        } as ChatMessage;
        return next;
      });
    };

    const onDone = (payload: { conversationHistory: Message[] }) => {
      console.log("onDone called with payload:", payload);
      setConversationHistory(payload.conversationHistory);
      setIsStreaming(false);
      streamAbortRef.current = null;
    };

    const onError = (err: Error) => {
      console.error("Stream error:", err);
      setIsStreaming(false);
      streamAbortRef.current = null;

      // Update the existing assistant placeholder with an error or fallback content
      setMessages((prev) => {
        const next = [...prev];
        const idx = assistantIndex >= 0 ? assistantIndex : next.length - 1;
        if (idx >= 0 && next[idx]) {
          next[idx] = {
            ...next[idx],
            content: "I encountered an error. Trying fallback...",
          } as ChatMessage;
        }
        return next;
      });

      // Fallback to non-streaming chat to avoid a dead end when stream fails (e.g., 404 if server not reloaded)
      void chatMutation
        .mutateAsync({
          message: userMessage.content,
          conversationHistory: conversationHistory,
        })
        .then((response) => {
          setMessages((prev) => {
            const next = [...prev];
            const idx = assistantIndex >= 0 ? assistantIndex : next.length - 1;
            if (idx >= 0 && next[idx]) {
              next[idx] = {
                role: "assistant",
                content: response.message,
                timestamp: new Date(),
                toolCalls: response.toolCalls,
              } as ChatMessage;
            }
            return next;
          });
          setConversationHistory(response.conversationHistory);
        })
        .catch(() => {
          setMessages((prev) => {
            const next = [...prev];
            const idx = assistantIndex >= 0 ? assistantIndex : next.length - 1;
            if (idx >= 0 && next[idx]) {
              next[idx] = {
                ...next[idx],
                content: "I encountered an error. Please try again.",
              } as ChatMessage;
            }
            return next;
          });
        });
    };

    const streamCtrl = apiService.chatStream(
      {
        message: userMessage.content,
        conversationHistory,
      },
      { onDelta, onMeta, onDone, onError }
    );
    streamAbortRef.current = streamCtrl;

    // Focus back on input
    inputRef.current?.focus();
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const clearChat = () => {
    setMessages([]);
    setConversationHistory([]);
    setInputMessage("");
  };

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] bg-background">
      {/* Header */}
      <div className="bg-card">
        <div className="container py-1 mx-auto max-w-6xl">
          <div className="flex justify-between items-center">
            <div></div>

            {/* Status indicators */}
            <div className="flex gap-2">
              <Badge
                variant={health?.status === "OK" ? "default" : "destructive"}
              >
                <Database className="mr-1 w-3 h-3" />
                {health?.status === "OK" ? "Online" : "Offline"}
              </Badge>
              {stats && (
                <Badge variant="secondary">{stats.totalDocuments} Docs</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Chat Messages Area */}
      <div className="overflow-hidden flex-1">
        <div className="container px-4 mx-auto max-w-4xl h-full">
          <ScrollArea
            className="h-[calc(100vh-200px)] py-6"
            ref={scrollAreaRef}
          >
            {messages.length === 0 ? (
              <div className="flex flex-col justify-center items-center h-full text-center">
                <Bot className="mb-4 w-16 h-16 text-muted-foreground" />
                <h3 className="mb-2 text-xl font-medium">
                  Welcome to Frappe AI Assistant!
                </h3>
                <p className="mb-4 max-w-md text-muted-foreground">
                  I'm here to help you with Frappe framework questions. I'll
                  search through the documentation and provide accurate answers
                  with sources.
                </p>
                <div className="grid gap-2 mt-4 w-full max-w-2xl">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setInputMessage("How do I create a new DocType?")
                    }
                    className="justify-start"
                  >
                    How do I create a new DocType?
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setInputMessage("Explain Frappe's permission system")
                    }
                    className="justify-start"
                  >
                    Explain Frappe's permission system
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setInputMessage("What are Server Scripts in Frappe?")
                    }
                    className="justify-start"
                  >
                    What are Server Scripts in Frappe?
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex gap-3 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {message.role === "assistant" && (
                      <div className="flex-shrink-0">
                        <div className="flex justify-center items-center w-8 h-8 rounded-full bg-primary text-primary-foreground">
                          <Bot className="w-5 h-5" />
                        </div>
                      </div>
                    )}

                    <div
                      className={`flex flex-col max-w-[80%] ${
                        message.role === "user" ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`rounded-lg px-4 py-3 ${
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {message.content}
                        </p>
                      </div>

                      <div className="flex gap-2 items-center mt-1">
                        <span className="text-xs text-muted-foreground">
                          {formatTime(message.timestamp)}
                        </span>
                        {message.toolCalls && message.toolCalls.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            🔧 Used {message.toolCalls.length} tool(s)
                          </Badge>
                        )}
                      </div>
                    </div>

                    {message.role === "user" && (
                      <div className="flex-shrink-0">
                        <div className="flex justify-center items-center w-8 h-8 rounded-full bg-secondary">
                          <User className="w-5 h-5" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {chatMutation.isPending && !isStreaming && (
                  <div className="flex gap-3 justify-start">
                    <div className="flex-shrink-0">
                      <div className="flex justify-center items-center w-8 h-8 rounded-full bg-primary text-primary-foreground">
                        <Bot className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="flex gap-2 items-center px-4 py-3 rounded-lg bg-muted">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">
                        Thinking...
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Error Display */}
      {chatMutation.isError && (
        <div className="container px-4 mx-auto max-w-4xl">
          <Alert className="mb-4">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>
              Chat error: {chatMutation.error?.message || "Unknown error"}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t bg-card">
        <div className="container px-4 py-4 mx-auto max-w-4xl">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <Input
              ref={inputRef}
              type="text"
              placeholder="Ask me anything about Frappe framework..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={chatMutation.isPending || isStreaming}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={
                !inputMessage.trim() || chatMutation.isPending || isStreaming
              }
              className="px-6"
            >
              {chatMutation.isPending || isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="mr-2 w-4 h-4" />
                  Send
                </>
              )}
            </Button>
            {messages.length > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  // stop any active stream and clear
                  if (streamAbortRef.current) streamAbortRef.current.abort();
                  setIsStreaming(false);
                  clearChat();
                }}
                disabled={chatMutation.isPending || isStreaming}
              >
                Clear
              </Button>
            )}
          </form>

          <p className="mt-2 text-xs text-center text-muted-foreground">
            AI responses may contain inaccuracies. Always verify with official
            documentation.
          </p>
        </div>
      </div>
    </div>
  );
}

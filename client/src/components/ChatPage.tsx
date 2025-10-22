import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Loader2, Database, AlertCircle, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChat, useHealth, useStats } from "../hooks/useApi";
import type { Message, ConversationWithMessages } from "../services/api";
import { apiService } from "../services/api";
import { ConversationSidebar } from "./ConversationSidebar";
import { MarkdownRenderer } from "./MarkdownRenderer";

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
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [refreshSidebar, setRefreshSidebar] = useState(0);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const chatMutation = useChat();
  const { data: health } = useHealth();
  const { data: stats } = useStats();

  // Loading state for API calls
  const [isLoading, setIsLoading] = useState(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  // Load conversation when selected
  const loadConversation = async (conversationId: string) => {
    try {
      const conversation = await apiService.getConversation(conversationId);
      const chatMessages: ChatMessage[] = conversation.messages.map(msg => ({
        role: msg.role as "user" | "assistant",
        content: msg.content || "",
        timestamp: new Date(msg.createdAt),
        toolCalls: msg.toolCalls,
      }));
      
      setMessages(chatMessages);
      setConversationHistory(conversation.messages);
      setCurrentConversationId(conversationId);
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
  };

  const handleConversationSelect = (conversationId: string) => {
    loadConversation(conversationId);
  };

  const handleNewConversation = () => {
    setMessages([]);
    setConversationHistory([]);
    setCurrentConversationId(null);
    setInputMessage("");
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || chatMutation.isPending || isLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: inputMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    try {
      const response = await chatMutation.mutateAsync({
        message: userMessage.content,
        conversationId: currentConversationId || undefined,
      });

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response.message,
        timestamp: new Date(),
        toolCalls: response.sources,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      
      // Update conversation ID if this was a new conversation
      if (!currentConversationId && response.conversationId) {
        setCurrentConversationId(response.conversationId);
        // Trigger sidebar refresh to show the new conversation
        setRefreshSidebar(prev => prev + 1);
      }

    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: "I encountered an error. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      // Focus back on input
      inputRef.current?.focus();
    }
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
    <div className="flex h-[calc(100vh-60px)] bg-background">
      {/* Sidebar */}
      {sidebarOpen && (
        <ConversationSidebar
          currentConversationId={currentConversationId || undefined}
          onConversationSelect={handleConversationSelect}
          onNewConversation={handleNewConversation}
          refreshTrigger={refreshSidebar}
        />
      )}

      {/* Main Chat Area */}
      <div className="flex flex-col flex-1">
        {/* Header */}
        <div className="bg-card border-b">
          <div className="container py-3 mx-auto max-w-6xl">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  <Menu className="w-4 h-4" />
                </Button>
                <h1 className="font-semibold">
                  {currentConversationId ? "Chat" : "New Conversation"}
                </h1>
              </div>

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
            className="h-[calc(100vh-200px)] py-6 px-4"
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
                        {message.role === "user" ? (
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {message.content}
                          </p>
                        ) : (
                          <MarkdownRenderer 
                            content={message.content}
                            isUserMessage={false}
                            className="text-sm"
                          />
                        )}
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
                {chatMutation.isPending && (
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
              disabled={chatMutation.isPending}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={
                !inputMessage.trim() || chatMutation.isPending
              }
              className="px-6"
            >
              {chatMutation.isPending ? (
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
                onClick={clearChat}
                disabled={chatMutation.isPending}
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
    </div>
  );
}

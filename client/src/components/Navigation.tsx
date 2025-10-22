import { Link, useLocation } from "react-router-dom";
import { Search, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Navigation() {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="border-b bg-card">
      <div className="container flex gap-4 items-center px-4 py-3 mx-auto max-w-6xl">
        <div className="flex gap-1 items-center mr-auto">
          <span className="text-xl font-bold">Frappe</span>
          <span className="text-xl font-bold text-primary">DocChat</span>
        </div>

        <div className="flex gap-2">
          <Button
            asChild
            variant={isActive("/search") ? "default" : "ghost"}
            size="sm"
          >
            <Link to="/search" className="flex gap-2 items-center">
              <Search className="w-4 h-4" />
              Search
            </Link>
          </Button>

          <Button
            asChild
            variant={isActive("/chat") ? "default" : "ghost"}
            size="sm"
          >
            <Link to="/chat" className="flex gap-2 items-center">
              <MessageCircle className="w-4 h-4" />
              Chat
            </Link>
          </Button>
        </div>
      </div>
    </nav>
  );
}

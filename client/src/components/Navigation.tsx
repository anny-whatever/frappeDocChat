import { Link, useLocation } from "react-router-dom";
import { Search, MessageCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "../contexts/AuthContext";

export function Navigation() {
  const location = useLocation();
  const { logout } = useAuth();

  const isActive = (path: string) => location.pathname === path;

  const handleLogout = () => {
    logout();
  };

  return (
    <nav className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="container flex gap-4 items-center px-4 py-3 mx-auto max-w-6xl">
        <div className="flex gap-2 items-center mr-auto">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary text-primary-foreground">
            <MessageCircle className="w-4 h-4" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Frappe</span>
          <span className="text-lg font-semibold tracking-tight text-primary">
            DocChat
          </span>
        </div>

        <div className="flex gap-1">
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

          <Button
            onClick={handleLogout}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </Button>
        </div>
      </div>
    </nav>
  );
}

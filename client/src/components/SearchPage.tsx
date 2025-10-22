import { useState } from "react";
import {
  Search,
  FileText,
  Clock,
  Database,
  AlertCircle,
  ExternalLink,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSearch, useStats, useHealth } from "../hooks/useApi";
import type { SearchResult } from "../services/api";

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(
    null
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  const searchMutation = useSearch();
  const { data: stats } = useStats();
  const { data: health } = useHealth();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setHasSearched(true);
    try {
      const result = await searchMutation.mutateAsync({
        query: query.trim(),
        limit: 10,
        threshold: 0.3,
      });
      setSearchResults(result.results);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    }
  };

  const formatSimilarity = (similarity: number) => {
    return `${(similarity * 100).toFixed(1)}%`;
  };

  const formatDate = (dateString: string) => {
    try {
      // Handle various date formats and invalid dates
      if (!dateString || dateString === "Invalid Date") {
        return "Unknown date";
      }

      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return "Unknown date";
      }

      return date.toLocaleDateString();
    } catch (error) {
      return "Unknown date";
    }
  };

  const truncateContent = (content: string, maxLength: number = 300) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  };

  const openModal = (result: SearchResult) => {
    setSelectedResult(result);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedResult(null);
  };

  const generateDocsUrl = (result: SearchResult) => {
    // Use sourceUrl if available, otherwise construct from filename
    if (result.sourceUrl) {
      return result.sourceUrl;
    }

    // Fallback: construct URL from filename
    const baseUrl = "https://docs.frappe.io/";
    const cleanFilename = result.filename
      .replace(/^framework_/, "")
      .replace(/\.json$/, "")
      .replace(/_/g, "/");
    return `${baseUrl}${cleanFilename}`;
  };

  return (
    <div className="container px-4 py-8 mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="mb-4 text-3xl font-bold">Documentation Search</h1>
        <p className="mb-6 text-muted-foreground">
          Search through Frappe framework documentation using AI-powered
          semantic search
        </p>

        {/* Status indicators */}
        <div className="flex gap-4 justify-center mb-6">
          <Badge variant={health?.status === "OK" ? "default" : "destructive"}>
            <Database className="mr-1 w-3 h-3" />
            {health?.status === "OK" ? "Server Online" : "Server Offline"}
          </Badge>
          {stats && (
            <Badge variant="secondary">
              <FileText className="mr-1 w-3 h-3" />
              {stats.totalDocuments} Documents
            </Badge>
          )}
        </div>
      </div>

      {/* Search Form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex gap-2 items-center">
            <Search className="w-5 h-5" />
            Search Documentation
          </CardTitle>
          <CardDescription>
            Enter your question or topic to find relevant Frappe documentation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              type="text"
              placeholder="e.g., How to create a DocType?, API authentication, database queries..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1"
              disabled={searchMutation.isPending}
            />
            <Button
              type="submit"
              disabled={!query.trim() || searchMutation.isPending}
              className="px-6"
            >
              {searchMutation.isPending ? (
                <>
                  <div className="mr-2 w-4 h-4 rounded-full border-2 border-white animate-spin border-t-transparent" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="mr-2 w-4 h-4" />
                  Search
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Error Display */}
      {searchMutation.isError && (
        <Alert className="mb-6">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            Search failed:{" "}
            {searchMutation.error?.message || "Unknown error occurred"}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {searchMutation.isPending && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="w-3/4 h-6" />
                <Skeleton className="w-1/2 h-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="mb-2 w-full h-4" />
                <Skeleton className="mb-2 w-full h-4" />
                <Skeleton className="w-2/3 h-4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Search Results */}
      {hasSearched && !searchMutation.isPending && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-semibold">
              Search Results
              {searchResults.length > 0 && (
                <span className="ml-2 text-lg text-muted-foreground">
                  ({searchResults.length} found)
                </span>
              )}
            </h2>
          </div>

          {searchResults.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="mx-auto mb-4 w-12 h-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium">No results found</h3>
                <p className="text-muted-foreground">
                  Try adjusting your search terms or check if the server is
                  running
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {searchResults.map((result) => (
                <Card
                  key={result.id}
                  className="transition-shadow hover:shadow-md"
                >
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex gap-4 items-center mb-2 text-sm text-muted-foreground">
                          <span className="flex gap-1 items-center">
                            <FileText className="w-3 h-3" />
                            {result.filename}
                          </span>
                        </div>
                      </div>
                      <Badge variant="outline" className="ml-4">
                        {formatSimilarity(result.similarity)} match
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="mb-4 text-sm leading-relaxed">
                      {truncateContent(result.content)}
                    </p>

                    {/* Action Buttons */}
                    <div className="flex gap-2 items-center pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openModal(result)}
                        className="flex gap-1 items-center"
                      >
                        <Eye className="w-3 h-3" />
                        View Full Content
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className="flex gap-1 items-center"
                      >
                        <a
                          href={generateDocsUrl(result)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View in Docs
                        </a>
                      </Button>
                    </div>

                    {result.metadata &&
                      Object.keys(result.metadata).length > 0 && (
                        <div className="pt-3 mt-3 border-t">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(result.metadata).map(
                              ([key, value]) => (
                                <Badge
                                  key={key}
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  {key}: {String(value)}
                                </Badge>
                              )
                            )}
                          </div>
                        </div>
                      )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Welcome message when no search has been performed */}
      {!hasSearched && !searchMutation.isPending && (
        <Card>
          <CardContent className="py-12 text-center">
            <Search className="mx-auto mb-6 w-16 h-16 text-muted-foreground" />
            <h3 className="mb-4 text-xl font-medium">
              Semantic Documentation Search
            </h3>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              This AI-powered search helps you find relevant information from
              the Frappe framework documentation. Enter your question or topic
              above to get started.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Modal for Full Content */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex gap-2 items-center">
              <FileText className="w-5 h-5" />
              {selectedResult?.filename}
            </DialogTitle>
            <DialogDescription className="flex gap-4 items-center text-sm">
              <span className="flex gap-1 items-center">
                <Clock className="w-3 h-3" />
                {selectedResult && formatDate(selectedResult.createdAt)}
              </span>
              <Badge variant="outline">
                {selectedResult && formatSimilarity(selectedResult.similarity)}{" "}
                match
              </Badge>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="max-w-none prose prose-sm">
              <pre className="p-4 text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-muted">
                {selectedResult?.content}
              </pre>
            </div>

            {/* Modal Action Buttons */}
            <div className="flex gap-2 items-center pt-4 border-t">
              <Button
                variant="default"
                asChild
                className="flex gap-1 items-center"
              >
                <a
                  href={selectedResult ? generateDocsUrl(selectedResult) : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-4 h-4" />
                  View in Frappe Documentation
                </a>
              </Button>

              <Button variant="outline" onClick={closeModal}>
                Close
              </Button>
            </div>

            {selectedResult?.metadata &&
              Object.keys(selectedResult.metadata).length > 0 && (
                <div className="pt-4 border-t">
                  <h4 className="mb-2 text-sm font-medium">Metadata</h4>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(selectedResult.metadata).map(
                      ([key, value]) => (
                        <Badge
                          key={key}
                          variant="secondary"
                          className="text-xs"
                        >
                          {key}: {String(value)}
                        </Badge>
                      )
                    )}
                  </div>
                </div>
              )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

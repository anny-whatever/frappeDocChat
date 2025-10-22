import { useState } from 'react';
import { Search, FileText, Clock, Database, AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearch, useStats, useHealth } from '../hooks/useApi';
import type { SearchResult } from '../services/api';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

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
        threshold: 0.3 
      });
      setSearchResults(result.results);
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
    }
  };

  const formatSimilarity = (similarity: number) => {
    return `${(similarity * 100).toFixed(1)}%`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const truncateContent = (content: string, maxLength: number = 300) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4">Frappe Documentation Search</h1>
        <p className="text-lg text-muted-foreground mb-6">
          Search through Frappe framework documentation using AI-powered semantic search
        </p>
        
        {/* Status indicators */}
        <div className="flex justify-center gap-4 mb-6">
          <Badge variant={health?.status === 'OK' ? 'default' : 'destructive'}>
            <Database className="w-3 h-3 mr-1" />
            {health?.status === 'OK' ? 'Server Online' : 'Server Offline'}
          </Badge>
          {stats && (
            <Badge variant="secondary">
              <FileText className="w-3 h-3 mr-1" />
              {stats.totalDocuments} Documents
            </Badge>
          )}
        </div>
      </div>

      {/* Search Form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
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
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
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
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Search failed: {searchMutation.error?.message || 'Unknown error occurred'}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {searchMutation.isPending && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Search Results */}
      {hasSearched && !searchMutation.isPending && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">
              Search Results
              {searchResults.length > 0 && (
                <span className="text-muted-foreground text-lg ml-2">
                  ({searchResults.length} found)
                </span>
              )}
            </h2>
          </div>

          {searchResults.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No results found</h3>
                <p className="text-muted-foreground">
                  Try adjusting your search terms or check if the server is running
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {searchResults.map((result) => (
                <Card key={result.id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg mb-2">
                          {result.title || result.filename}
                        </CardTitle>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {result.filename}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(result.createdAt)}
                          </span>
                        </div>
                      </div>
                      <Badge variant="outline" className="ml-4">
                        {formatSimilarity(result.similarity)} match
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed">
                      {truncateContent(result.content)}
                    </p>
                    
                    {/* Source Link */}
                    {result.sourceUrl && (
                      <div className="mt-3 pt-3 border-t">
                        <a
                          href={result.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View in Frappe Documentation
                        </a>
                      </div>
                    )}
                    
                    {result.metadata && Object.keys(result.metadata).length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(result.metadata).map(([key, value]) => (
                            <Badge key={key} variant="secondary" className="text-xs">
                              {key}: {String(value)}
                            </Badge>
                          ))}
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
          <CardContent className="text-center py-12">
            <Search className="w-16 h-16 mx-auto text-muted-foreground mb-6" />
            <h3 className="text-xl font-medium mb-4">Welcome to Frappe Documentation Search</h3>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              This AI-powered search helps you find relevant information from the Frappe framework documentation. 
              Enter your question or topic above to get started.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
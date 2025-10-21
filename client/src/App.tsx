import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchPage } from './components/SearchPage';
import './App.css'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background">
        <SearchPage />
      </div>
    </QueryClientProvider>
  )
}

export default App

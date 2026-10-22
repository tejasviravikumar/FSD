import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error?.status === 401 || error?.status === 403 || error?.status === 404) return false
        return failureCount < 1
      },
      refetchOnWindowFocus: false,
    },
  },
})

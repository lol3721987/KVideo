/**
 * Search History Store using Zustand
 * Manages search query history with localStorage persistence
 * Following Liquid Glass design principles
 */

import { create } from 'zustand';
import {
  persist,
  createJSONStorage,
  type PersistStorage,
  type StorageValue,
} from 'zustand/middleware';
import { profiledKey } from '@/lib/utils/profile-storage';

const MAX_HISTORY_ITEMS = 20;
const MAX_QUERY_LENGTH = 120;
const SEARCH_HISTORY_RETRY_LIMITS = [MAX_HISTORY_ITEMS, 10, 5, 1] as const;

export interface SearchHistoryItem {
  query: string;
  timestamp: number;
  resultCount?: number;
}

interface SearchHistoryStore {
  searchHistory: SearchHistoryItem[];

  // Actions
  addToSearchHistory: (query: string, resultCount?: number) => void;
  removeFromSearchHistory: (query: string) => void;
  clearSearchHistory: () => void;
  getRecentSearches: (limit?: number) => SearchHistoryItem[];
}
type PersistedSearchHistoryState = Pick<SearchHistoryStore, 'searchHistory'>;

function sanitizeQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_QUERY_LENGTH
    ? trimmed.slice(0, MAX_QUERY_LENGTH)
    : trimmed;
}

function sanitizeHistoryItem(item: SearchHistoryItem): SearchHistoryItem {
  const query = sanitizeQuery(item.query);
  const timestamp = Number.isFinite(item.timestamp) ? item.timestamp : Date.now();
  const hasValidResultCount = typeof item.resultCount === 'number' && Number.isFinite(item.resultCount);

  return {
    query,
    timestamp,
    ...(hasValidResultCount ? { resultCount: item.resultCount } : {}),
  };
}

function sanitizeSearchHistory(
  history: SearchHistoryItem[] | undefined,
  maxItems: number
): SearchHistoryItem[] {
  if (!Array.isArray(history) || maxItems <= 0) return [];
  return history
    .map((item) => sanitizeHistoryItem(item))
    .filter((item) => item.query.length > 0)
    .slice(0, maxItems);
}

function withSanitizedState(
  value: StorageValue<PersistedSearchHistoryState>,
  maxItems: number
): StorageValue<PersistedSearchHistoryState> {
  return {
    ...value,
    state: {
      searchHistory: sanitizeSearchHistory(value.state?.searchHistory, maxItems),
    },
  };
}

function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return true;
  }
  if ('code' in error && typeof (error as { code?: unknown }).code === 'number') {
    const code = (error as { code: number }).code;
    return code === 22 || code === 1014;
  }
  return false;
}

function createSafeSearchHistoryStorage(): PersistStorage<PersistedSearchHistoryState> | undefined {
  const jsonStorage = createJSONStorage<PersistedSearchHistoryState>(() => localStorage);
  if (!jsonStorage) return undefined;

  return {
    ...jsonStorage,
    setItem: (storageKey, value) => {
      for (const maxItems of SEARCH_HISTORY_RETRY_LIMITS) {
        try {
          jsonStorage.setItem(storageKey, withSanitizedState(value, maxItems));
          return;
        } catch (error) {
          if (!isQuotaExceededError(error)) {
            console.error('[SearchHistoryStore] Failed to persist search history:', error);
            return;
          }
        }
      }

      // Last-resort recovery: clear current key and keep one latest entry.
      try {
        jsonStorage.removeItem(storageKey);
        jsonStorage.setItem(storageKey, withSanitizedState(value, 1));
      } catch (error) {
        console.error('[SearchHistoryStore] Failed to persist minimal search history after quota recovery:', error);
      }
    },
  };
}

/**
 * Normalize query for comparison (trim, lowercase)
 */
function normalizeQuery(query: string): string {
  return sanitizeQuery(query).toLowerCase();
}

const createSearchHistoryStore = (name: string) =>
  create<SearchHistoryStore>()(
    persist(
      (set, get) => ({
        searchHistory: [],

        addToSearchHistory: (query, resultCount) => {
          const trimmedQuery = sanitizeQuery(query);

          // Don't add empty queries
          if (!trimmedQuery) return;

          const normalized = normalizeQuery(trimmedQuery);
          const timestamp = Date.now();

          set((state) => {
            // Check if query already exists (case-insensitive)
            const existingIndex = state.searchHistory.findIndex(
              (item) => normalizeQuery(item.query) === normalized
            );

            let newHistory: SearchHistoryItem[];

            if (existingIndex !== -1) {
              // Update existing item and move to top
              const updatedItem: SearchHistoryItem = {
                query: trimmedQuery, // Keep original casing from new search
                timestamp,
                resultCount,
              };

              newHistory = [
                updatedItem,
                ...state.searchHistory.filter((_, index) => index !== existingIndex),
              ];
            } else {
              // Add new item at the top
              const newItem: SearchHistoryItem = {
                query: trimmedQuery,
                timestamp,
                resultCount,
              };

              newHistory = [newItem, ...state.searchHistory];
            }

            // Trim to max items
            if (newHistory.length > MAX_HISTORY_ITEMS) {
              newHistory = newHistory.slice(0, MAX_HISTORY_ITEMS);
            }

            return { searchHistory: newHistory };
          });
        },

        removeFromSearchHistory: (query) => {
          const normalized = normalizeQuery(query);

          set((state) => ({
            searchHistory: state.searchHistory.filter(
              (item) => normalizeQuery(item.query) !== normalized
            ),
          }));
        },

        clearSearchHistory: () => {
          set({ searchHistory: [] });
        },

        getRecentSearches: (limit = 10) => {
          const history = get().searchHistory;
          return history.slice(0, limit);
        },
      }),
      {
        name,
        version: 2,
        storage: createSafeSearchHistoryStorage(),
        partialize: (state) => ({
          searchHistory: sanitizeSearchHistory(state.searchHistory, MAX_HISTORY_ITEMS),
        }),
        migrate: (persistedState: any) => {
          const baseHistory: SearchHistoryItem[] = Array.isArray(persistedState?.searchHistory)
            ? persistedState.searchHistory
            : [];

          return {
            ...persistedState,
            searchHistory: sanitizeSearchHistory(baseHistory, MAX_HISTORY_ITEMS),
          };
        },
      }
    )
  );

export const useSearchHistoryStore = createSearchHistoryStore(profiledKey('kvideo-search-history'));
export const usePremiumSearchHistoryStore = createSearchHistoryStore(profiledKey('kvideo-premium-search-history'));

/**
 * Helper hook to get the appropriate search history store
 */
export function useSearchHistoryStoreSelector(isPremium = false) {
  const normalStore = useSearchHistoryStore();
  const premiumStore = usePremiumSearchHistoryStore();
  return isPremium ? premiumStore : normalStore;
}

/**
 * History State Store using Zustand
 * Manages viewing history with localStorage persistence
 */

import { create } from 'zustand';
import {
  persist,
  createJSONStorage,
  type PersistStorage,
  type StorageValue,
} from 'zustand/middleware';
import type { VideoHistoryItem, Episode } from '@/lib/types';
import { clearSegmentsForUrl, clearAllCache } from '@/lib/utils/cacheManager';
import { profiledKey } from '@/lib/utils/profile-storage';

const MAX_HISTORY_ITEMS = 50;
const MAX_PERSISTED_HISTORY_ITEMS = 30;
const MAX_PERSISTED_EPISODES = 20;
const MAX_SOURCE_MAP_ENTRIES = 20;
const MAX_URL_LENGTH = 512;
const MAX_TEXT_LENGTH = 180;

interface HistoryState {
  viewingHistory: VideoHistoryItem[];
}

interface HistoryActions {
  addToHistory: (
    videoId: string | number,
    title: string,
    url: string,
    episodeIndex: number,
    source: string,
    playbackPosition: number,
    duration: number,
    poster?: string,
    episodes?: Episode[],
    metadata?: { vod_actor?: string; type_name?: string; vod_area?: string }
  ) => void;

  removeFromHistory: (showIdentifier: string) => void;
  clearHistory: () => void;
  importHistory: (history: VideoHistoryItem[]) => void;
}

interface HistoryStore extends HistoryState, HistoryActions { }
type PersistedHistoryState = Pick<HistoryState, 'viewingHistory'>;

const HISTORY_STORAGE_RETRY_PLAN = [
  { maxItems: MAX_PERSISTED_HISTORY_ITEMS, maxEpisodes: MAX_PERSISTED_EPISODES },
  { maxItems: 20, maxEpisodes: 8 },
  { maxItems: 10, maxEpisodes: 0 },
] as const;

function trimText(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeEpisodeIndex(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function sanitizeEpisodes(episodes: Episode[] | undefined, maxEpisodes: number): Episode[] {
  if (!Array.isArray(episodes) || maxEpisodes <= 0) return [];
  return episodes.slice(0, maxEpisodes).map((episode, index) => ({
    name: trimText(episode.name, 80) || `第${index + 1}集`,
    // url is not used by history UI; omit it to reduce localStorage footprint.
    url: '',
    index: Number.isFinite(episode.index) ? episode.index : index,
  }));
}

function sanitizeSourceMap(
  sourceMap: Record<string, string | number> | undefined,
  source: string,
  videoId: string | number
): Record<string, string | number> {
  const normalizedSource = source.trim();
  const entries: Array<[string, string | number]> = [];

  if (normalizedSource) {
    entries.push([normalizedSource, videoId]);
  }

  if (sourceMap && typeof sourceMap === 'object') {
    for (const [key, value] of Object.entries(sourceMap)) {
      if (!key || key === normalizedSource) continue;
      entries.push([key, value]);
      if (entries.length >= MAX_SOURCE_MAP_ENTRIES) break;
    }
  }

  if (entries.length === 0) {
    entries.push([source, videoId]);
  }

  return Object.fromEntries(entries.slice(0, MAX_SOURCE_MAP_ENTRIES));
}

function sanitizeHistoryItem(item: VideoHistoryItem, maxEpisodes: number): VideoHistoryItem {
  const safeTitle = trimText(item.title, MAX_TEXT_LENGTH) || '未知视频';
  const safeSource = trimText(item.source, 64) || 'unknown';
  const safeTimestamp = Number.isFinite(item.timestamp) ? item.timestamp : Date.now();
  const safePlaybackPosition = Number.isFinite(item.playbackPosition) ? item.playbackPosition : 0;
  const safeDuration = Number.isFinite(item.duration) ? item.duration : 0;
  const safeEpisodeIndex = normalizeEpisodeIndex(item.episodeIndex);

  return {
    ...item,
    title: safeTitle,
    source: safeSource,
    url: trimText(item.url, MAX_URL_LENGTH) || '',
    timestamp: safeTimestamp,
    playbackPosition: safePlaybackPosition,
    duration: safeDuration,
    episodeIndex: safeEpisodeIndex,
    showIdentifier: generateShowIdentifier(safeTitle),
    poster: trimText(item.poster, MAX_URL_LENGTH),
    episodes: sanitizeEpisodes(item.episodes, maxEpisodes),
    sourceMap: sanitizeSourceMap(item.sourceMap, safeSource, item.videoId),
    vod_actor: trimText(item.vod_actor, MAX_TEXT_LENGTH),
    type_name: trimText(item.type_name, 80),
    vod_area: trimText(item.vod_area, 80),
  };
}

function sanitizeHistoryForPersist(
  history: VideoHistoryItem[] | undefined,
  maxItems: number,
  maxEpisodes: number
): VideoHistoryItem[] {
  if (!Array.isArray(history) || maxItems <= 0) return [];
  return history
    .slice(0, maxItems)
    .map((item) => sanitizeHistoryItem(item, maxEpisodes));
}

function withSanitizedState(
  value: StorageValue<PersistedHistoryState>,
  maxItems: number,
  maxEpisodes: number
): StorageValue<PersistedHistoryState> {
  return {
    ...value,
    state: {
      viewingHistory: sanitizeHistoryForPersist(value.state?.viewingHistory, maxItems, maxEpisodes),
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

function createSafeHistoryStorage(): PersistStorage<PersistedHistoryState> | undefined {
  const jsonStorage = createJSONStorage<PersistedHistoryState>(() => localStorage);
  if (!jsonStorage) return undefined;

  return {
    ...jsonStorage,
    setItem: (storageKey, value) => {
      for (const { maxItems, maxEpisodes } of HISTORY_STORAGE_RETRY_PLAN) {
        try {
          jsonStorage.setItem(storageKey, withSanitizedState(value, maxItems, maxEpisodes));
          return;
        } catch (error) {
          if (!isQuotaExceededError(error)) {
            console.error('[HistoryStore] Failed to persist history:', error);
            return;
          }
        }
      }

      // Last-resort recovery: clear the old value and persist a minimal snapshot.
      try {
        jsonStorage.removeItem(storageKey);
        const minimal = withSanitizedState(value, 5, 0);
        jsonStorage.setItem(storageKey, minimal);
      } catch (error) {
        console.error('[HistoryStore] Failed to persist minimal history after quota recovery:', error);
      }
    },
  };
}

/**
 * Generate unique identifier for deduplication (source-agnostic)
 */
function generateShowIdentifier(title: string): string {
  return `title:${title.toLowerCase().trim()}`;
}

/**
 * Migrate v1 history entries to v2 (merge entries with same title)
 */
function migrateHistory(history: VideoHistoryItem[]): VideoHistoryItem[] {
  const merged = new Map<string, VideoHistoryItem>();

  for (const item of history) {
    const newId = generateShowIdentifier(item.title);

    const existing = merged.get(newId);
    if (existing) {
      // Keep the more recent entry, merge sourceMap
      const isNewer = item.timestamp > existing.timestamp;
      const mergedSourceMap = {
        ...(existing.sourceMap || { [existing.source]: existing.videoId }),
        ...(item.sourceMap || { [item.source]: item.videoId }),
      };

      merged.set(newId, {
        ...(isNewer ? item : existing),
        showIdentifier: newId,
        sourceMap: mergedSourceMap,
        // Keep newer playback state
        playbackPosition: isNewer ? item.playbackPosition : existing.playbackPosition,
        duration: isNewer ? item.duration : existing.duration,
        episodeIndex: isNewer ? item.episodeIndex : existing.episodeIndex,
        url: isNewer ? item.url : existing.url,
        source: isNewer ? item.source : existing.source,
        videoId: isNewer ? item.videoId : existing.videoId,
        timestamp: Math.max(item.timestamp, existing.timestamp),
        episodes: (isNewer ? item.episodes : existing.episodes) || [],
        poster: isNewer ? (item.poster || existing.poster) : (existing.poster || item.poster),
      });
    } else {
      merged.set(newId, {
        ...item,
        showIdentifier: newId,
        sourceMap: item.sourceMap || { [item.source]: item.videoId },
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp);
}

const createHistoryStore = (name: string) =>
  create<HistoryStore>()(
    persist(
      (set, get) => ({
        viewingHistory: [],

        addToHistory: (
          videoId,
          title,
          url,
          episodeIndex,
          source,
          playbackPosition,
          duration,
          poster,
          episodes = [],
          metadata
        ) => {
          const showIdentifier = generateShowIdentifier(title);
          const timestamp = Date.now();

          set((state) => {
            // Check if item already exists (by normalized title)
            const existingIndex = state.viewingHistory.findIndex(
              (item) => item.showIdentifier === showIdentifier
            );

            let newHistory: VideoHistoryItem[];

            if (existingIndex !== -1) {
              const existing = state.viewingHistory[existingIndex];
              // Merge sourceMap
              const mergedSourceMap = {
                ...(existing.sourceMap || { [existing.source]: existing.videoId }),
                [source]: videoId,
              };

              // Update existing item and move to top
              const updatedItem: VideoHistoryItem = {
                ...existing,
                videoId,
                source,
                url,
                episodeIndex,
                playbackPosition,
                duration,
                timestamp,
                sourceMap: mergedSourceMap,
                episodes: episodes.length > 0 ? episodes : existing.episodes,
                poster: poster || existing.poster,
                vod_actor: metadata?.vod_actor ?? existing.vod_actor,
                type_name: metadata?.type_name ?? existing.type_name,
                vod_area: metadata?.vod_area ?? existing.vod_area,
              };

              newHistory = [
                updatedItem,
                ...state.viewingHistory.filter((_, index) => index !== existingIndex),
              ];
            } else {
              // Add new item at the top
              const newItem: VideoHistoryItem = {
                videoId,
                title,
                url,
                episodeIndex,
                source,
                timestamp,
                playbackPosition,
                duration,
                poster,
                episodes,
                showIdentifier,
                sourceMap: { [source]: videoId },
                vod_actor: metadata?.vod_actor,
                type_name: metadata?.type_name,
                vod_area: metadata?.vod_area,
              };

              newHistory = [newItem, ...state.viewingHistory];
            }

            // Limit history size
            if (newHistory.length > MAX_HISTORY_ITEMS) {
              newHistory = newHistory.slice(0, MAX_HISTORY_ITEMS);
            }

            return { viewingHistory: newHistory };
          });
        },

        removeFromHistory: (showIdentifier) => {
          const state = get();
          const itemToRemove = state.viewingHistory.find(
            (item) => item.showIdentifier === showIdentifier
          );

          if (itemToRemove) {
            // Clear cache for this video
            clearSegmentsForUrl(itemToRemove.url);
          }

          set((state) => ({
            viewingHistory: state.viewingHistory.filter(
              (item) => item.showIdentifier !== showIdentifier
            ),
          }));
        },

        clearHistory: () => {
          // Clear all cached segments
          clearAllCache();
          set({ viewingHistory: [] });
        },

        importHistory: (history) => {
          set({
            viewingHistory: sanitizeHistoryForPersist(
              history,
              MAX_HISTORY_ITEMS,
              MAX_PERSISTED_EPISODES
            ),
          });
        },
      }),
      {
        name,
        version: 3,
        storage: createSafeHistoryStorage(),
        partialize: (state) => ({
          viewingHistory: sanitizeHistoryForPersist(
            state.viewingHistory,
            MAX_PERSISTED_HISTORY_ITEMS,
            MAX_PERSISTED_EPISODES
          ),
        }),
        migrate: (persistedState: any, version: number) => {
          const baseHistory: VideoHistoryItem[] = Array.isArray(persistedState?.viewingHistory)
            ? persistedState.viewingHistory
            : [];

          if (version < 2) {
            // Migrate from v1: merge entries with same normalized title
            const oldHistory = baseHistory;
            return {
              ...persistedState,
              viewingHistory: sanitizeHistoryForPersist(
                migrateHistory(oldHistory),
                MAX_PERSISTED_HISTORY_ITEMS,
                MAX_PERSISTED_EPISODES
              ),
            };
          }

          return {
            ...persistedState,
            viewingHistory: sanitizeHistoryForPersist(
              baseHistory,
              MAX_PERSISTED_HISTORY_ITEMS,
              MAX_PERSISTED_EPISODES
            ),
          };
        },
      }
    )
  );

export const useHistoryStore = createHistoryStore(profiledKey('kvideo-history-store'));
export const usePremiumHistoryStore = createHistoryStore(profiledKey('kvideo-premium-history-store'));

/**
 * Helper hook to get the appropriate history store
 */
export function useHistory(isPremium = false) {
  const normalStore = useHistoryStore();
  const premiumStore = usePremiumHistoryStore();
  return isPremium ? premiumStore : normalStore;
}

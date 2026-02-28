/**
 * Favorites Store - Manages user's favorite videos
 * Uses Zustand with localStorage persistence
 */

import { create } from 'zustand';
import { persist, type StorageValue } from 'zustand/middleware';
import type { FavoriteItem } from '@/lib/types';
import { profiledKey } from '@/lib/utils/profile-storage';
import { createSafePersistStorage } from '@/lib/utils/safe-storage';

const MAX_FAVORITES = 100;
const FAVORITES_PERSIST_RETRY_LIMITS = [80, 40, 20] as const;

interface FavoritesState {
    favorites: FavoriteItem[];
}

interface FavoritesActions {
    addFavorite: (item: Omit<FavoriteItem, 'addedAt'>) => void;
    removeFavorite: (videoId: string | number, source: string) => void;
    toggleFavorite: (item: Omit<FavoriteItem, 'addedAt'>) => boolean;
    isFavorite: (videoId: string | number, source: string) => boolean;
    clearFavorites: () => void;
    importFavorites: (favorites: FavoriteItem[]) => void;
}

interface FavoritesStore extends FavoritesState, FavoritesActions { }
type PersistedFavoritesState = Pick<FavoritesState, 'favorites'>;

function trimFavorites(items: FavoriteItem[] | undefined, maxItems: number): FavoriteItem[] {
    if (!Array.isArray(items) || maxItems <= 0) return [];
    return items.slice(0, maxItems);
}

function withTrimmedFavorites(
    value: StorageValue<PersistedFavoritesState>,
    maxItems: number
): StorageValue<PersistedFavoritesState> {
    return {
        ...value,
        state: {
            favorites: trimFavorites(value.state?.favorites, maxItems),
        },
    };
}

/**
 * Generate unique identifier for a favorite item
 */
function generateFavoriteId(
    videoId: string | number,
    source: string
): string {
    return `${source}:${videoId}`;
}

const createFavoritesStore = (name: string) =>
    create<FavoritesStore>()(
        persist(
            (set, get) => ({
                favorites: [],

                addFavorite: (item) => {
                    const favoriteId = generateFavoriteId(item.videoId, item.source);

                    set((state) => {
                        // Check if already exists
                        const exists = state.favorites.some(
                            (fav) => generateFavoriteId(fav.videoId, fav.source) === favoriteId
                        );

                        if (exists) {
                            return state;
                        }

                        const newFavorite: FavoriteItem = {
                            ...item,
                            addedAt: Date.now(),
                        };

                        let newFavorites = [newFavorite, ...state.favorites];

                        // Limit favorites size
                        if (newFavorites.length > MAX_FAVORITES) {
                            newFavorites = newFavorites.slice(0, MAX_FAVORITES);
                        }

                        return { favorites: newFavorites };
                    });
                },

                removeFavorite: (videoId, source) => {
                    const favoriteId = generateFavoriteId(videoId, source);

                    set((state) => ({
                        favorites: state.favorites.filter(
                            (fav) => generateFavoriteId(fav.videoId, fav.source) !== favoriteId
                        ),
                    }));
                },

                toggleFavorite: (item) => {
                    const state = get();
                    const favoriteId = generateFavoriteId(item.videoId, item.source);
                    const exists = state.favorites.some(
                        (fav) => generateFavoriteId(fav.videoId, fav.source) === favoriteId
                    );

                    if (exists) {
                        state.removeFavorite(item.videoId, item.source);
                        return false;
                    } else {
                        state.addFavorite(item);
                        return true;
                    }
                },

                isFavorite: (videoId, source) => {
                    const state = get();
                    const favoriteId = generateFavoriteId(videoId, source);
                    return state.favorites.some(
                        (fav) => generateFavoriteId(fav.videoId, fav.source) === favoriteId
                    );
                },

                clearFavorites: () => {
                    set({ favorites: [] });
                },

                importFavorites: (favorites) => {
                    set({ favorites: trimFavorites(favorites, MAX_FAVORITES) });
                },
            }),
            {
                name,
                storage: createSafePersistStorage<PersistedFavoritesState>({
                    label: 'FavoritesStore',
                    reducers: FAVORITES_PERSIST_RETRY_LIMITS.map(
                        (maxItems) => (value) => withTrimmedFavorites(value, maxItems)
                    ),
                    fallbackReducer: (value) => withTrimmedFavorites(value, 10),
                }),
                partialize: (state) => ({
                    favorites: trimFavorites(state.favorites, MAX_FAVORITES),
                }),
            }
        )
    );

export const useFavoritesStore = createFavoritesStore(profiledKey('kvideo-favorites-store'));
export const usePremiumFavoritesStore = createFavoritesStore(profiledKey('kvideo-premium-favorites-store'));

/**
 * Helper hook to get the appropriate favorites store
 */
export function useFavorites(isPremium = false) {
    const normalStore = useFavoritesStore();
    const premiumStore = usePremiumFavoritesStore();
    return isPremium ? premiumStore : normalStore;
}

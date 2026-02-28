import {
  createJSONStorage,
  type PersistStorage,
  type StorageValue,
} from 'zustand/middleware';

interface SafeStorageWriteOptions {
  context?: string;
  silent?: boolean;
}

type PersistValueReducer<S> = (value: StorageValue<S>) => StorageValue<S>;

interface SafePersistStorageOptions<S> {
  label: string;
  reducers?: PersistValueReducer<S>[];
  fallbackReducer?: PersistValueReducer<S>;
}

function getBrowserStorage(type: 'localStorage' | 'sessionStorage'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window[type];
  } catch {
    return null;
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  if (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  ) {
    return true;
  }

  if ('code' in error && typeof (error as { code?: unknown }).code === 'number') {
    const code = (error as { code: number }).code;
    return code === 22 || code === 1014;
  }

  return false;
}

export function safeStorageSetItem(
  storage: Storage | null,
  key: string,
  value: string,
  options: SafeStorageWriteOptions = {}
): boolean {
  const { context = 'Storage', silent = false } = options;
  if (!storage) return false;

  try {
    storage.setItem(key, value);
    return true;
  } catch (error) {
    if (!silent) {
      if (isQuotaExceededError(error)) {
        console.warn(`[${context}] Storage quota exceeded while writing key: ${key}`);
      } else {
        console.error(`[${context}] Failed to write key: ${key}`, error);
      }
    }
    return false;
  }
}

export function safeLocalStorageSetItem(
  key: string,
  value: string,
  options: SafeStorageWriteOptions = {}
): boolean {
  return safeStorageSetItem(getBrowserStorage('localStorage'), key, value, options);
}

export function safeSessionStorageSetItem(
  key: string,
  value: string,
  options: SafeStorageWriteOptions = {}
): boolean {
  return safeStorageSetItem(getBrowserStorage('sessionStorage'), key, value, options);
}

function applyReducerSafely<S>(
  value: StorageValue<S>,
  reducer: PersistValueReducer<S> | undefined,
  label: string
): StorageValue<S> {
  if (!reducer) return value;
  try {
    return reducer(value);
  } catch (error) {
    console.error(`[${label}] Failed to reduce persisted state:`, error);
    return value;
  }
}

/**
 * Create a JSON persist storage that never throws on setItem.
 * It retries with reduced payloads when quota is exceeded.
 */
export function createSafePersistStorage<S>({
  label,
  reducers = [],
  fallbackReducer,
}: SafePersistStorageOptions<S>): PersistStorage<S> | undefined {
  const jsonStorage = createJSONStorage<S>(() => localStorage);
  if (!jsonStorage) return undefined;

  return {
    ...jsonStorage,
    setItem: (storageKey, value) => {
      const attempts: Array<StorageValue<S>> = [
        value,
        ...reducers.map((reducer) => applyReducerSafely(value, reducer, label)),
      ];

      for (const attemptValue of attempts) {
        try {
          jsonStorage.setItem(storageKey, attemptValue);
          return;
        } catch (error) {
          if (!isQuotaExceededError(error)) {
            console.error(`[${label}] Failed to persist state:`, error);
            return;
          }
        }
      }

      try {
        jsonStorage.removeItem(storageKey);
        if (fallbackReducer) {
          const fallbackValue = applyReducerSafely(value, fallbackReducer, label);
          jsonStorage.setItem(storageKey, fallbackValue);
        }
      } catch (error) {
        console.error(`[${label}] Failed to persist fallback state:`, error);
      }
    },
  };
}

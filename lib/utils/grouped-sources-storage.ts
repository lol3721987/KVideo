export interface GroupedSourceEntry {
    id: string | number;
    source: string;
    sourceName?: string;
    latency?: number;
    pic?: string;
    typeName?: string;
}

interface GroupedSourcesEnvelope {
    createdAt: number;
    data: GroupedSourceEntry[];
}

const STORAGE_PREFIX = 'kvideo:grouped-sources:';
const STORAGE_INDEX_KEY = 'kvideo:grouped-sources:index';
const MAX_STORED_ITEMS = 200;
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function getStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function isValidSourceEntry(item: unknown): item is GroupedSourceEntry {
    if (!item || typeof item !== 'object') return false;
    const entry = item as GroupedSourceEntry;
    return (
        (typeof entry.id === 'string' || typeof entry.id === 'number') &&
        typeof entry.source === 'string' &&
        entry.source.trim().length > 0
    );
}

function normalizeGroupedSources(input: unknown): GroupedSourceEntry[] {
    if (!Array.isArray(input)) return [];
    return input.filter(isValidSourceEntry);
}

function readEnvelope(storage: Storage, key: string): GroupedSourcesEnvelope | null {
    const raw = storage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as GroupedSourcesEnvelope;
        if (
            !parsed ||
            typeof parsed.createdAt !== 'number' ||
            !Array.isArray(parsed.data)
        ) {
            return null;
        }

        return {
            createdAt: parsed.createdAt,
            data: normalizeGroupedSources(parsed.data),
        };
    } catch {
        return null;
    }
}

function writeIndex(storage: Storage, keys: string[]): void {
    storage.setItem(STORAGE_INDEX_KEY, JSON.stringify(keys));
}

function readIndex(storage: Storage): string[] {
    const raw = storage.getItem(STORAGE_INDEX_KEY);
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((key: unknown) => typeof key === 'string');
    } catch {
        return [];
    }
}

function cleanupStorage(storage: Storage): void {
    const now = Date.now();
    const nextKeys: string[] = [];
    const keys = readIndex(storage);

    for (const key of keys) {
        const envelope = readEnvelope(storage, key);
        if (!envelope) {
            storage.removeItem(`${STORAGE_PREFIX}${key}`);
            continue;
        }

        if (now - envelope.createdAt > MAX_AGE_MS) {
            storage.removeItem(`${STORAGE_PREFIX}${key}`);
            continue;
        }

        nextKeys.push(key);
    }

    const trimmed = nextKeys.slice(-MAX_STORED_ITEMS);
    const removed = nextKeys.slice(0, Math.max(0, nextKeys.length - MAX_STORED_ITEMS));
    removed.forEach((key) => {
        storage.removeItem(`${STORAGE_PREFIX}${key}`);
    });
    writeIndex(storage, trimmed);
}

export function parseGroupedSourcesParam(raw: string | null): GroupedSourceEntry[] {
    if (!raw) return [];
    try {
        return normalizeGroupedSources(JSON.parse(raw));
    } catch {
        return [];
    }
}

export function saveGroupedSources(entries: GroupedSourceEntry[]): string | null {
    if (!entries || entries.length === 0) return null;

    const storage = getStorage();
    if (!storage) return null;

    try {
        cleanupStorage(storage);
        const key = `gs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const payload: GroupedSourcesEnvelope = {
            createdAt: Date.now(),
            data: entries,
        };
        storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(payload));

        const keys = readIndex(storage);
        keys.push(key);
        writeIndex(storage, keys.slice(-MAX_STORED_ITEMS));
        return key;
    } catch {
        return null;
    }
}

export function loadGroupedSources(key: string | null): GroupedSourceEntry[] {
    if (!key) return [];

    const storage = getStorage();
    if (!storage) return [];

    try {
        const envelope = readEnvelope(storage, key);
        if (!envelope) return [];

        if (Date.now() - envelope.createdAt > MAX_AGE_MS) {
            storage.removeItem(`${STORAGE_PREFIX}${key}`);
            cleanupStorage(storage);
            return [];
        }

        return envelope.data;
    } catch {
        return [];
    }
}

export function setGroupedSourcesParam(
    params: URLSearchParams,
    entries: GroupedSourceEntry[] | null | undefined
): void {
    // Always clear legacy/current params first to avoid carrying large payloads.
    params.delete('groupedSources');
    params.delete('gsk');

    if (!entries || entries.length <= 1) return;

    const key = saveGroupedSources(entries);
    if (key) {
        params.set('gsk', key);
        return;
    }

    // Fallback only when storage is unavailable.
    params.set('groupedSources', JSON.stringify(entries));
}

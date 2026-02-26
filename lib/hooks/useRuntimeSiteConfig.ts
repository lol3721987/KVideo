'use client';

import { useEffect, useState } from 'react';
import { siteConfig, type SiteConfig } from '@/lib/config/site-config';

interface AuthConfigResponse {
    siteName?: unknown;
    siteTitle?: unknown;
    siteDescription?: unknown;
}

let cachedConfig: SiteConfig | null = null;
let inflight: Promise<SiteConfig> | null = null;

function normalizeRuntimeSiteConfig(data: AuthConfigResponse | null | undefined): SiteConfig {
    if (!data || typeof data !== 'object') {
        return siteConfig;
    }

    const name = typeof data.siteName === 'string' && data.siteName.trim()
        ? data.siteName.trim()
        : siteConfig.name;
    const title = typeof data.siteTitle === 'string' && data.siteTitle.trim()
        ? data.siteTitle.trim()
        : siteConfig.title;
    const description = typeof data.siteDescription === 'string' && data.siteDescription.trim()
        ? data.siteDescription.trim()
        : siteConfig.description;

    return { name, title, description };
}

async function fetchRuntimeSiteConfig(): Promise<SiteConfig> {
    if (cachedConfig) {
        return cachedConfig;
    }

    if (!inflight) {
        inflight = fetch('/api/auth', {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
        })
            .then(async (res) => {
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = (await res.json()) as AuthConfigResponse;
                const normalized = normalizeRuntimeSiteConfig(data);
                cachedConfig = normalized;
                return normalized;
            })
            .catch(() => siteConfig)
            .finally(() => {
                inflight = null;
            });
    }

    return inflight;
}

/**
 * Read site branding from runtime API (server env), with local fallback.
 */
export function useRuntimeSiteConfig(): SiteConfig {
    const [runtimeConfig, setRuntimeConfig] = useState<SiteConfig>(cachedConfig || siteConfig);

    useEffect(() => {
        let mounted = true;

        void fetchRuntimeSiteConfig().then((config) => {
            if (!mounted) return;
            setRuntimeConfig(config);
        });

        return () => {
            mounted = false;
        };
    }, []);

    return runtimeConfig;
}


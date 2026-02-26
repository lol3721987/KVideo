/**
 * Site Configuration
 * Handles environment variables for site branding and customization
 */

export interface SiteConfig {
    title: string;
    description: string;
    name: string;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
    title: 'KVideo - 视频聚合平台',
    description: '视频聚合平台',
    name: 'KVideo',
};

function pickFirstNonEmpty(...values: Array<string | undefined>): string | undefined {
    return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();
}

/**
 * Server-side runtime config resolver.
 * Priority:
 * 1) SITE_* (runtime-oriented)
 * 2) NEXT_PUBLIC_SITE_* (backward compatibility)
 * 3) defaults
 */
export function getServerSiteConfig(): SiteConfig {
    return {
        title: pickFirstNonEmpty(process.env.SITE_TITLE, process.env.NEXT_PUBLIC_SITE_TITLE) || DEFAULT_SITE_CONFIG.title,
        description: pickFirstNonEmpty(process.env.SITE_DESCRIPTION, process.env.NEXT_PUBLIC_SITE_DESCRIPTION) || DEFAULT_SITE_CONFIG.description,
        name: pickFirstNonEmpty(process.env.SITE_NAME, process.env.NEXT_PUBLIC_SITE_NAME) || DEFAULT_SITE_CONFIG.name,
    };
}

/**
 * Client-side fallback config.
 * Keep it static to avoid relying on NEXT_PUBLIC build-time injection.
 */
export const siteConfig: SiteConfig = DEFAULT_SITE_CONFIG;

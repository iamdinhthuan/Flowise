/**
 * Centralized feature flags for Flowise Lite.
 *
 * Controls which features are enabled/disabled at runtime.
 * The server exposes these to the UI via the /api/v1/settings endpoint.
 *
 * Chatflows, Assistants, and Marketplaces have been permanently removed
 * from this Lite build. Only Agentflows-related features remain.
 */

export interface FeatureFlags {
    // Reserved for future use — add new feature toggles here
}

/**
 * Resolve feature flags from environment.
 */
export function getFeatureFlags(): FeatureFlags {
    return {}
}

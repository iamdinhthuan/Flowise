export const isOpenSourceAuthEnabled = (): boolean => {
    return process.env.FLOWISE_OPEN_SOURCE_AUTH_ENABLED !== 'false'
}

export const isOpenSourceInternalHeaderBypassEnabled = (): boolean => {
    return !isOpenSourceAuthEnabled() || process.env.FLOWISE_ALLOW_UNSAFE_INTERNAL_HEADER === 'true'
}

import { isOpenSourceAuthEnabled, isOpenSourceInternalHeaderBypassEnabled } from './openSourceAuthMode'

const ORIGINAL_ENV = process.env

describe('openSourceAuthMode', () => {
    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV }
        delete process.env.FLOWISE_OPEN_SOURCE_AUTH_ENABLED
        delete process.env.FLOWISE_ALLOW_UNSAFE_INTERNAL_HEADER
    })

    afterAll(() => {
        process.env = ORIGINAL_ENV
    })

    it('enables Open Source auth by default', () => {
        expect(isOpenSourceAuthEnabled()).toBe(true)
        expect(isOpenSourceInternalHeaderBypassEnabled()).toBe(false)
    })

    it('allows the legacy internal header bypass only when explicitly configured', () => {
        process.env.FLOWISE_OPEN_SOURCE_AUTH_ENABLED = 'false'

        expect(isOpenSourceAuthEnabled()).toBe(false)
        expect(isOpenSourceInternalHeaderBypassEnabled()).toBe(true)
    })

    it('supports an explicit unsafe bypass override for backwards compatibility', () => {
        process.env.FLOWISE_ALLOW_UNSAFE_INTERNAL_HEADER = 'true'

        expect(isOpenSourceAuthEnabled()).toBe(true)
        expect(isOpenSourceInternalHeaderBypassEnabled()).toBe(true)
    })
})

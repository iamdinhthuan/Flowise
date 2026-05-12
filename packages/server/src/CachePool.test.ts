const redisValues = new Map<string, string>()

const mockRedisSet = jest.fn(async (key: string, value: string) => {
    redisValues.set(key, value)
    return 'OK'
})
const mockRedisGet = jest.fn(async (key: string) => redisValues.get(key) ?? null)
const mockRedisDel = jest.fn(async (key: string) => {
    const existed = redisValues.delete(key)
    return existed ? 1 : 0
})
const mockRedisQuit = jest.fn(async () => 'OK')

const mockRedisConstructor = jest.fn().mockImplementation(() => ({
    set: mockRedisSet,
    get: mockRedisGet,
    del: mockRedisDel,
    quit: mockRedisQuit
}))

jest.mock('ioredis', () => mockRedisConstructor)

import Redis from 'ioredis'
import { CachePool } from './CachePool'

describe('CachePool', () => {
    const originalEnv = process.env

    beforeEach(() => {
        process.env = { ...originalEnv }
        delete process.env.MODE
        delete process.env.CACHE_POOL_REDIS_ENABLED
        delete process.env.REDIS_URL
        delete process.env.REDIS_HOST
        delete process.env.REDIS_PORT
        redisValues.clear()
        jest.clearAllMocks()
    })

    afterAll(() => {
        process.env = originalEnv
    })

    it('uses in-memory cache by default', async () => {
        const cachePool = new CachePool()
        const llmCache = new Map([['prompt', 'answer']])

        await cachePool.addLLMCache('chatflow-1', llmCache)

        expect(Redis).not.toHaveBeenCalled()
        await expect(cachePool.getLLMCache('chatflow-1')).resolves.toEqual(llmCache)
    })

    it('uses Redis cache outside queue mode when CACHE_POOL_REDIS_ENABLED is true', async () => {
        process.env.CACHE_POOL_REDIS_ENABLED = 'true'
        process.env.REDIS_URL = 'redis://redis:6379'

        const cachePool = new CachePool()
        const llmCache = new Map([['prompt', 'answer']])

        await cachePool.addLLMCache('chatflow-1', llmCache)

        expect(Redis).toHaveBeenCalledWith('redis://redis:6379', expect.any(Object))
        expect(mockRedisSet).toHaveBeenCalledWith('llmCache:chatflow-1', JSON.stringify(Array.from(llmCache.entries())), 'EX', 86400)
        await expect(cachePool.getLLMCache('chatflow-1')).resolves.toEqual(llmCache)
    })

    it('keeps queue mode Redis behavior enabled by default', async () => {
        process.env.MODE = 'queue'
        process.env.REDIS_HOST = 'redis'
        process.env.REDIS_PORT = '6379'

        const cachePool = new CachePool()
        const embeddingCache = new Map([['text', [0.1, 0.2]]])

        await cachePool.addEmbeddingCache('chatflow-1', embeddingCache)

        expect(Redis).toHaveBeenCalledWith(expect.objectContaining({ host: 'redis', port: 6379 }))
        await expect(cachePool.getEmbeddingCache('chatflow-1')).resolves.toEqual(embeddingCache)
    })
})

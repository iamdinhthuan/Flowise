const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 0 }),
    name: 'flowise-queue-prediction'
}

jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => mockQueue),
    QueueEvents: jest.fn().mockImplementation(() => ({})),
    Worker: jest.fn().mockImplementation(() => ({}))
}))
jest.mock('../utils/logger', () => ({
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}))
jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('job-1') }))

import { BaseQueue } from './BaseQueue'

class TestQueue extends BaseQueue {
    async processJob(data: any): Promise<any> {
        return data
    }

    getQueueName(): string {
        return 'test'
    }

    getQueue(): any {
        return mockQueue
    }
}

describe('BaseQueue admission control', () => {
    const ORIGINAL_ENV = process.env

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV }
        delete process.env.QUEUE_MAX_WAITING_JOBS
        jest.clearAllMocks()
        mockQueue.add.mockResolvedValue({ id: 'job-1' })
        mockQueue.getJobCounts.mockResolvedValue({ waiting: 0 })
    })

    afterAll(() => {
        process.env = ORIGINAL_ENV
    })

    it('rejects new jobs when waiting depth reaches the configured limit', async () => {
        process.env.QUEUE_MAX_WAITING_JOBS = '2'
        mockQueue.getJobCounts.mockResolvedValue({ waiting: 1, delayed: 1 })
        const queue = new TestQueue('flowise-queue-prediction', { host: 'localhost', port: 6379 })

        await expect(queue.addJob({ input: 'hello' })).rejects.toThrow('QUEUE_MAX_WAITING_JOBS')
        expect(mockQueue.add).not.toHaveBeenCalled()
    })

    it('allows disabling admission control with -1', async () => {
        process.env.QUEUE_MAX_WAITING_JOBS = '-1'
        mockQueue.getJobCounts.mockResolvedValue({ waiting: 10000 })
        const queue = new TestQueue('flowise-queue-prediction', { host: 'localhost', port: 6379 })

        await expect(queue.addJob({ input: 'hello' })).resolves.toEqual({ id: 'job-1' })
        expect(mockQueue.add).toHaveBeenCalledTimes(1)
    })
})

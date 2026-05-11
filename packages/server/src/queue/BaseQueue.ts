import { Queue, Worker, Job, QueueEvents, RedisOptions, KeepJobs } from 'bullmq'
import { v4 as uuidv4 } from 'uuid'
import logger from '../utils/logger'

const QUEUE_REDIS_EVENT_STREAM_MAX_LEN = process.env.QUEUE_REDIS_EVENT_STREAM_MAX_LEN
    ? parseInt(process.env.QUEUE_REDIS_EVENT_STREAM_MAX_LEN)
    : 10000
const DEFAULT_WORKER_CONCURRENCY = 5
const DEFAULT_REMOVE_ON_AGE = 24 * 60 * 60
const DEFAULT_REMOVE_ON_COUNT = 1000

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback
    const parsedValue = parseInt(value)
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback
}

const parseRetentionInteger = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback
    const parsedValue = parseInt(value)
    return Number.isFinite(parsedValue) ? parsedValue : fallback
}

const normalizeQueueNameForEnv = (queueName: string): string => queueName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()

const getQueueTypeForEnv = (queueName: string): string | undefined => {
    const normalizedQueueName = queueName.toLowerCase()
    if (normalizedQueueName.includes('prediction')) return 'PREDICTION'
    if (normalizedQueueName.includes('upsert')) return 'UPSERT'
    if (normalizedQueueName.includes('schedule')) return 'SCHEDULE'
    return undefined
}

const getWorkerConcurrency = (queueName: string): number => {
    const queueSpecificEnvName = `${normalizeQueueNameForEnv(queueName)}_WORKER_CONCURRENCY`
    const queueTypeEnvName = getQueueTypeForEnv(queueName)
    return parsePositiveInteger(
        process.env[queueSpecificEnvName] ||
            (queueTypeEnvName ? process.env[`${queueTypeEnvName}_WORKER_CONCURRENCY`] : undefined) ||
            process.env.WORKER_CONCURRENCY,
        DEFAULT_WORKER_CONCURRENCY
    )
}

const buildKeepJobs = (): KeepJobs | undefined => {
    const removeOnAge = parseRetentionInteger(process.env.REMOVE_ON_AGE, DEFAULT_REMOVE_ON_AGE)
    const removeOnCount = parseRetentionInteger(process.env.REMOVE_ON_COUNT, DEFAULT_REMOVE_ON_COUNT)

    if (removeOnAge === -1 && removeOnCount === -1) return undefined

    const keepJobObj: KeepJobs = {}
    if (removeOnAge !== -1) {
        keepJobObj.age = removeOnAge
    }
    if (removeOnCount !== -1) {
        keepJobObj.count = removeOnCount
    }
    return keepJobObj
}

export abstract class BaseQueue {
    protected queue: Queue
    protected queueEvents: QueueEvents
    protected connection: RedisOptions
    private worker: Worker

    constructor(queueName: string, connection: RedisOptions) {
        this.connection = connection
        this.queue = new Queue(queueName, {
            connection: this.connection,
            streams: { events: { maxLen: QUEUE_REDIS_EVENT_STREAM_MAX_LEN } }
        })
        this.queueEvents = new QueueEvents(queueName, { connection: this.connection })
    }

    abstract processJob(data: any): Promise<any>

    abstract getQueueName(): string

    abstract getQueue(): Queue

    public getWorker(): Worker {
        return this.worker
    }

    public async addJob(jobData: any): Promise<Job> {
        const jobId = jobData.id || uuidv4()

        const keepJobs = buildKeepJobs()
        const removeOnFail: number | boolean | KeepJobs | undefined = keepJobs || true
        const removeOnComplete: number | boolean | KeepJobs | undefined = keepJobs

        return await this.queue.add(jobId, jobData, { removeOnFail, removeOnComplete })
    }

    public createWorker(concurrency: number = getWorkerConcurrency(this.queue.name)): Worker {
        try {
            this.worker = new Worker(
                this.queue.name,
                async (job: Job) => {
                    const start = new Date().getTime()
                    logger.info(`[BaseQueue] Processing job ${job.id} in ${this.queue.name} at ${new Date().toISOString()}`)
                    try {
                        const result = await this.processJob(job.data)
                        const end = new Date().getTime()
                        logger.info(
                            `[BaseQueue] Completed job ${job.id} in ${this.queue.name} at ${new Date().toISOString()} (${end - start}ms)`
                        )
                        return result
                    } catch (error) {
                        const end = new Date().getTime()
                        logger.error(
                            `[BaseQueue] Job ${job.id} failed in ${this.queue.name} at ${new Date().toISOString()} (${end - start}ms):`,
                            { error }
                        )
                        throw error
                    }
                },
                {
                    connection: this.connection,
                    concurrency
                }
            )

            // Add error listeners to the worker
            this.worker.on('error', (err) => {
                logger.error(`[BaseQueue] Worker error for queue "${this.queue.name}":`, { error: err })
            })

            this.worker.on('closed', () => {
                logger.info(`[BaseQueue] Worker closed for queue "${this.queue.name}"`)
            })

            this.worker.on('failed', (job, err) => {
                logger.error(`[BaseQueue] Worker job ${job?.id} failed in queue "${this.queue.name}":`, { error: err })
            })

            logger.info(`[BaseQueue] Worker created successfully for queue "${this.queue.name}"`)
            return this.worker
        } catch (error) {
            logger.error(`[BaseQueue] Failed to create worker for queue "${this.queue.name}":`, { error })
            throw error
        }
    }

    public async getJobs(): Promise<Job[]> {
        return await this.queue.getJobs()
    }

    public async getJobCounts(): Promise<{ [index: string]: number }> {
        return await this.queue.getJobCounts()
    }

    public async getJobByName(jobName: string): Promise<Job> {
        const jobs = await this.queue.getJobs()
        const job = jobs.find((job) => job.name === jobName)
        if (!job) throw new Error(`Job name ${jobName} not found`)
        return job
    }

    public getQueueEvents(): QueueEvents {
        return this.queueEvents
    }

    public async clearQueue(): Promise<void> {
        await this.queue.obliterate({ force: true })
    }
}

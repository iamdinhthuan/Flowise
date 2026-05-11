import { ExpressAdapter } from '@bull-board/express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { Request, Response } from 'express'
import 'global-agent/bootstrap'
import http from 'http'
import path from 'path'
import { DataSource } from 'typeorm'
import { AbortControllerPool } from './AbortControllerPool'
import { CachePool } from './CachePool'
import { ChatFlow } from './database/entities/ChatFlow'
import { getDataSource } from './DataSource'
import { Organization } from './enterprise/database/entities/organization.entity'
import { Workspace } from './enterprise/database/entities/workspace.entity'
import { LoggedInUser } from './enterprise/Interface.Enterprise'
import { getOrCreateOpenSourceUser } from './utils/openSourceAuth'
import { initializeJwtCookieMiddleware, verifyToken, verifyTokenForBullMQDashboard } from './enterprise/middleware/passport'
import { initAuthSecrets } from './enterprise/utils/authSecrets'
import { IdentityManager } from './IdentityManager'
import { MODE, Platform } from './Interface'
import { IMetricsProvider } from './Interface.Metrics'
import { OpenTelemetry } from './metrics/OpenTelemetry'
import { Prometheus } from './metrics/Prometheus'
import errorHandlerMiddleware from './middlewares/errors'
import { NodesPool } from './NodesPool'
import { QueueManager } from './queue/QueueManager'
import { ScheduleBeat } from './schedule/ScheduleBeat'
import { RedisEventSubscriber } from './queue/RedisEventSubscriber'
import { initWebhookListenerRegistry } from './services/webhook-listener'
import flowiseApiV1Router from './routes'
import { UsageCacheManager } from './UsageCacheManager'
import { getEncryptionKey, getNodeModulesPackagePath } from './utils'
import { API_KEY_BLACKLIST_URLS, WHITELIST_URLS } from './utils/constants'
import logger, { expressRequestLogger } from './utils/logger'
import { RateLimiterManager } from './utils/rateLimit'
import { SSEStreamer } from './utils/SSEStreamer'
import { Telemetry } from './utils/telemetry'
import { validateAPIKey } from './utils/validateKey'
import { getCorsOptions, getIframeSecurityHeaders, sanitizeMiddleware, validateCorsConfig } from './utils/XSS'

declare global {
    namespace Express {
        interface User extends LoggedInUser {}
        interface Request {
            user?: LoggedInUser
        }
        namespace Multer {
            interface File {
                bucket: string
                key: string
                acl: string
                contentType: string
                contentDisposition: null
                storageClass: string
                serverSideEncryption: null
                metadata: any
                location: string
                etag: string
            }
        }
    }
}

export class App {
    app: express.Application
    server?: http.Server
    nodesPool: NodesPool
    abortControllerPool: AbortControllerPool
    cachePool: CachePool
    telemetry: Telemetry
    rateLimiterManager: RateLimiterManager
    AppDataSource: DataSource = getDataSource()
    sseStreamer: SSEStreamer
    identityManager: IdentityManager
    metricsProvider: IMetricsProvider
    queueManager: QueueManager
    redisSubscriber: RedisEventSubscriber
    usageCacheManager: UsageCacheManager
    sessionStore: any

    constructor() {
        this.app = express()
    }

    async initDatabase() {
        // Initialize database
        try {
            await this.AppDataSource.initialize()
            logger.info('📦 [server]: Data Source initialized successfully')

            // SQLite performance tuning for lightweight deployments
            if (!process.env.DATABASE_TYPE || process.env.DATABASE_TYPE === 'sqlite') {
                try {
                    await this.AppDataSource.query('PRAGMA journal_mode = WAL')
                    await this.AppDataSource.query('PRAGMA synchronous = NORMAL')
                    await this.AppDataSource.query('PRAGMA cache_size = -2000')
                    await this.AppDataSource.query('PRAGMA temp_store = MEMORY')
                    logger.info('⚡ [server]: SQLite PRAGMA optimizations applied (WAL, NORMAL sync)')
                } catch (e) {
                    logger.warn('⚠️ [server]: Failed to apply SQLite PRAGMA optimizations')
                }
            }

            // Run Migrations Scripts
            await this.AppDataSource.runMigrations({ transaction: 'each' })
            logger.info('🔄 [server]: Database migrations completed successfully')

            // Initialize Identity Manager
            this.identityManager = await IdentityManager.getInstance()
            logger.info('🔐 [server]: Identity Manager initialized successfully')

            // Initialize nodes pool
            this.nodesPool = new NodesPool()
            await this.nodesPool.initialize()
            logger.info('🔧 [server]: Nodes pool initialized successfully')

            // Initialize abort controllers pool
            this.abortControllerPool = new AbortControllerPool()
            logger.info('⏹️ [server]: Abort controllers pool initialized successfully')

            // Initialize encryption key
            await getEncryptionKey()
            logger.info('🔑 [server]: Encryption key initialized successfully')

            // Initialize auth secrets (env → AWS Secrets Manager → filesystem)
            await initAuthSecrets()
            logger.info('🔐 [server]: Auth initialized successfully')

            // Initialize Rate Limit (lazy — don't preload all chatflows)
            this.rateLimiterManager = RateLimiterManager.getInstance()
            logger.info('🚦 [server]: Rate limiter manager initialized (lazy mode)')

            // Initialize cache pool
            this.cachePool = new CachePool()
            logger.info('💾 [server]: Cache pool initialized successfully')

            // Initialize usage cache manager (skip if LITE_MODE)
            if (process.env.LITE_MODE !== 'true') {
                this.usageCacheManager = await UsageCacheManager.getInstance()
                logger.info('📊 [server]: Usage cache manager initialized successfully')
            }

            // Initialize telemetry (disabled in lite mode — no PostHog calls)
            if (process.env.LITE_MODE !== 'true') {
                this.telemetry = new Telemetry()
                logger.info('📈 [server]: Telemetry initialized successfully')
            } else {
                // Telemetry without POSTHOG_PUBLIC_API_KEY is already a no-op — no type hacks needed
                const savedKey = process.env.POSTHOG_PUBLIC_API_KEY
                delete process.env.POSTHOG_PUBLIC_API_KEY
                this.telemetry = new Telemetry()
                if (savedKey) process.env.POSTHOG_PUBLIC_API_KEY = savedKey
                logger.info('📈 [server]: Telemetry disabled (LITE_MODE)')
            }

            // Initialize SSE Streamer
            this.sseStreamer = new SSEStreamer()
            this.sseStreamer.startHeartbeat()
            logger.info('🌊 [server]: SSE Streamer initialized successfully')

            // Init Queues
            if (process.env.MODE === MODE.QUEUE) {
                this.queueManager = QueueManager.getInstance()
                const serverAdapter = new ExpressAdapter()
                serverAdapter.setBasePath('/admin/queues')
                this.queueManager.setupAllQueues({
                    componentNodes: this.nodesPool.componentNodes,
                    telemetry: this.telemetry,
                    cachePool: this.cachePool,
                    appDataSource: this.AppDataSource,
                    abortControllerPool: this.abortControllerPool,
                    usageCacheManager: this.usageCacheManager,
                    identityManager: this.identityManager,
                    serverAdapter
                })
                logger.info('✅ [Queue]: All queues setup successfully')

                this.redisSubscriber = new RedisEventSubscriber(this.sseStreamer)
                await this.redisSubscriber.connect()
                this.redisSubscriber.startPeriodicCleanup()
                logger.info('🔗 [server]: Redis event subscriber connected successfully')
            }

            await initWebhookListenerRegistry(this.sseStreamer, this.redisSubscriber)
            logger.info('📡 [server]: Webhook listener registry initialized successfully')

            // Init ScheduleBeat only if enabled
            if (process.env.ENABLE_SCHEDULE === 'true') {
                await ScheduleBeat.getInstance().init()
                logger.info('⏰ [server]: ScheduleBeat initialized successfully')
            } else {
                logger.info('⏰ [server]: ScheduleBeat skipped (set ENABLE_SCHEDULE=true to enable)')
            }

            logger.info('🎉 [server]: All initialization steps completed successfully!')
        } catch (error) {
            logger.error('❌ [server]: Error during Data Source initialization:', error)
        }
    }

    async config() {
        // Limit is needed to allow sending/receiving base64 encoded string
        const flowise_file_size_limit = process.env.FLOWISE_FILE_SIZE_LIMIT || '50mb'
        const default_body_size_limit = process.env.FLOWISE_DEFAULT_BODY_SIZE_LIMIT || '5mb'
        const largeBodyRoutePrefixes = [
            '/api/v1/prediction/',
            '/api/v1/internal-prediction/',
            '/api/v1/webhook/',
            '/api/v1/chatflows-uploads',
            '/api/v1/vector/',
            '/api/v1/attachments',
            '/api/v1/document-store',
            '/api/v1/openai-assistants-file'
        ]
        const useLargeBodyParser = (req: Request): boolean => largeBodyRoutePrefixes.some((prefix) => req.path.startsWith(prefix))

        // Preserve raw bytes before JSON parsing for webhook HMAC signature verification
        const captureRawBody = (req: Request, _res: Response, buf: Buffer) => {
            if (req.path.startsWith('/api/v1/webhook/')) {
                ;(req as any).rawBody = buf
            }
        }
        const defaultJsonParser = express.json({ limit: default_body_size_limit, verify: captureRawBody })
        const largeJsonParser = express.json({ limit: flowise_file_size_limit, verify: captureRawBody })
        const defaultUrlencodedParser = express.urlencoded({
            limit: default_body_size_limit,
            extended: true,
            verify: captureRawBody
        })
        const largeUrlencodedParser = express.urlencoded({
            limit: flowise_file_size_limit,
            extended: true,
            verify: captureRawBody
        })
        this.app.use((req, res, next) => (useLargeBodyParser(req) ? largeJsonParser : defaultJsonParser)(req, res, next))
        this.app.use((req, res, next) => (useLargeBodyParser(req) ? largeUrlencodedParser : defaultUrlencodedParser)(req, res, next))

        // Enhanced trust proxy settings for load balancer
        let trustProxy: string | boolean | number | undefined = process.env.TRUST_PROXY
        if (typeof trustProxy === 'undefined' || (typeof trustProxy === 'string' && trustProxy.trim() === '') || trustProxy === 'true') {
            // Default to trust all proxies
            trustProxy = true
        } else if (trustProxy === 'false') {
            // Disable trust proxy
            trustProxy = false
        } else if (!isNaN(Number(trustProxy))) {
            // Number: Trust specific number of proxies
            trustProxy = Number(trustProxy)
        }

        this.app.set('trust proxy', trustProxy)

        // Allow access from specified domains
        validateCorsConfig()
        this.app.use(cors(getCorsOptions()))

        // Parse cookies
        this.app.use(cookieParser())

        // Allow embedding from specified domains.
        const iframeSecurityHeaders = getIframeSecurityHeaders()
        this.app.use((req, res, next) => {
            for (const [headerName, headerValue] of Object.entries(iframeSecurityHeaders)) {
                res.setHeader(headerName, headerValue)
            }
            next()
        })

        // Switch off the default 'X-Powered-By: Express' header
        this.app.disable('x-powered-by')

        // Add the expressRequestLogger middleware to log all requests
        this.app.use(expressRequestLogger)

        // Add the sanitizeMiddleware to guard against XSS
        this.app.use(sanitizeMiddleware)

        this.app.get('/api/v1/livez', (_req: Request, res: Response) => {
            return res.status(200).json({ status: 'live' })
        })

        this.app.get('/api/v1/readyz', async (_req: Request, res: Response) => {
            const checks: Record<string, boolean> = {
                app: true,
                database: this.AppDataSource.isInitialized,
                nodesPool: !!this.nodesPool?.componentNodes,
                cachePool: !!this.cachePool,
                sseStreamer: !!this.sseStreamer
            }

            if (checks.database) {
                try {
                    await this.AppDataSource.query('SELECT 1')
                } catch (error) {
                    checks.database = false
                    logger.warn('Readiness database check failed', { error })
                }
            }

            const isReady = Object.values(checks).every(Boolean)
            return res.status(isReady ? 200 : 503).json({
                status: isReady ? 'ready' : 'not_ready',
                checks
            })
        })

        const denylistURLs = process.env.DENYLIST_URLS ? process.env.DENYLIST_URLS.split(',') : []
        const whitelistURLs = WHITELIST_URLS.filter((url) => !denylistURLs.includes(url))
        const URL_CASE_INSENSITIVE_REGEX: RegExp = /\/api\/v1\//i
        const URL_CASE_SENSITIVE_REGEX: RegExp = /\/api\/v1\//

        await initializeJwtCookieMiddleware(this.app, this.identityManager)

        this.app.use(async (req, res, next) => {
            // Step 1: Check if the req path contains /api/v1 regardless of case
            if (URL_CASE_INSENSITIVE_REGEX.test(req.path)) {
                // Step 2: Check if the req path is casesensitive
                if (URL_CASE_SENSITIVE_REGEX.test(req.path)) {
                    // Step 3: Check if the req path is in the whitelist
                    const isWhitelisted = whitelistURLs.some((url) => req.path.startsWith(url))
                    if (isWhitelisted) {
                        next()
                    } else if (req.headers['x-request-from'] === 'internal') {
                        // Open Source: skip auth entirely, inject default user
                        if (this.identityManager.isOpenSource()) {
                            try {
                                const osUser = await getOrCreateOpenSourceUser(this.AppDataSource)
                                req.user = osUser as LoggedInUser
                            } catch (e) {
                                logger.error(`❌ [server]: Open Source bootstrap error: ${e}`)
                            }
                            next()
                        } else {
                            verifyToken(req, res, next)
                        }
                    } else {
                        const isAPIKeyBlacklistedURLS = API_KEY_BLACKLIST_URLS.some((url) => req.path.startsWith(url))
                        if (isAPIKeyBlacklistedURLS) {
                            return res.status(401).json({ error: 'Unauthorized Access' })
                        }

                        // Only check license validity for non-open-source platforms
                        if (this.identityManager.getPlatformType() !== Platform.OPEN_SOURCE) {
                            if (!this.identityManager.isLicenseValid()) {
                                return res.status(401).json({ error: 'Unauthorized Access' })
                            }
                        }

                        const { isValid, apiKey } = await validateAPIKey(req)
                        if (!isValid || !apiKey) {
                            return res.status(401).json({ error: 'Unauthorized Access' })
                        }

                        // Find workspace
                        const workspace = await this.AppDataSource.getRepository(Workspace).findOne({
                            where: { id: apiKey.workspaceId }
                        })
                        if (!workspace) {
                            return res.status(401).json({ error: 'Unauthorized Access' })
                        }

                        // Find organization
                        const activeOrganizationId = workspace.organizationId as string
                        const org = await this.AppDataSource.getRepository(Organization).findOne({
                            where: { id: activeOrganizationId }
                        })
                        if (!org) {
                            return res.status(401).json({ error: 'Unauthorized Access' })
                        }
                        const subscriptionId = org.subscriptionId as string
                        const customerId = org.customerId as string
                        const features = await this.identityManager.getFeaturesByPlan(subscriptionId)
                        const productId = await this.identityManager.getProductIdFromSubscription(subscriptionId)
                        // @ts-ignore
                        req.user = {
                            permissions: apiKey.permissions,
                            features,
                            activeOrganizationId: activeOrganizationId,
                            activeOrganizationSubscriptionId: subscriptionId,
                            activeOrganizationCustomerId: customerId,
                            activeOrganizationProductId: productId,
                            isOrganizationAdmin: false,
                            activeWorkspaceId: workspace.id,
                            activeWorkspace: workspace.name
                        }
                        next()
                    }
                } else {
                    return res.status(401).json({ error: 'Unauthorized Access' })
                }
            } else {
                // If the req path does not contain /api/v1, then allow the request to pass through, example: /assets, /canvas
                next()
            }
        })

        // this is for SSO and must be after the JWT cookie middleware
        await this.identityManager.initializeSSO(this.app)

        if (process.env.ENABLE_METRICS === 'true') {
            switch (process.env.METRICS_PROVIDER) {
                // default to prometheus
                case 'prometheus':
                case undefined:
                    this.metricsProvider = new Prometheus(this.app)
                    break
                case 'open_telemetry':
                    this.metricsProvider = new OpenTelemetry(this.app)
                    break
                // add more cases for other metrics providers here
            }
            if (this.metricsProvider) {
                await this.metricsProvider.initializeCounters()
                logger.info(`📊 [server]: Metrics Provider [${this.metricsProvider.getName()}] has been initialized!`)
            } else {
                logger.error(
                    "❌ [server]: Metrics collection is enabled, but failed to initialize provider (valid values are 'prometheus' or 'open_telemetry'."
                )
            }
        }

        this.app.use('/api/v1', flowiseApiV1Router)

        // ----------------------------------------
        // Configure number of proxies in Host Environment
        // ----------------------------------------
        this.app.get('/api/v1/ip', (request, response) => {
            response.send({
                ip: request.ip,
                msg: 'Check returned IP address in the response. If it matches your current IP address ( which you can get by going to http://ip.nfriedly.com/ or https://api.ipify.org/ ), then the number of proxies is correct and the rate limiter should now work correctly. If not, increase the number of proxies by 1 and restart Cloud-Hosted Flowise until the IP address matches your own. Visit https://docs.flowiseai.com/configuration/rate-limit#cloud-hosted-rate-limit-setup-guide for more information.'
            })
        })

        if (process.env.MODE === MODE.QUEUE && process.env.ENABLE_BULLMQ_DASHBOARD === 'true' && !this.identityManager.isCloud()) {
            // Initialize admin queues rate limiter
            const id = 'bullmq_admin_dashboard'
            await this.rateLimiterManager.addRateLimiter(
                id,
                60,
                100,
                process.env.ADMIN_RATE_LIMIT_MESSAGE || 'Too many requests to admin dashboard, please try again later.'
            )

            const rateLimiter = this.rateLimiterManager.getRateLimiterById(id)
            this.app.use('/admin/queues', rateLimiter, verifyTokenForBullMQDashboard, this.queueManager.getBullBoardRouter())
        }

        // ----------------------------------------
        // Serve UI static
        // ----------------------------------------

        const packagePath = getNodeModulesPackagePath('flowise-ui')
        const uiBuildPath = path.join(packagePath, 'build')
        const uiHtmlPath = path.join(packagePath, 'build', 'index.html')

        this.app.use(
            '/',
            express.static(uiBuildPath, {
                etag: true,
                setHeaders: (res, filePath) => {
                    if (path.basename(filePath) === 'index.html') {
                        res.setHeader('Cache-Control', 'no-cache')
                    } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
                        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
                    } else {
                        res.setHeader('Cache-Control', 'public, max-age=3600')
                    }
                }
            })
        )

        // All other requests not handled will return React app
        this.app.use((req: Request, res: Response) => {
            res.setHeader('Cache-Control', 'no-cache')
            res.sendFile(uiHtmlPath)
        })

        // Error handling
        this.app.use(errorHandlerMiddleware)
    }

    async stopApp() {
        try {
            this.sseStreamer?.stopHeartbeat()
            const removePromises: any[] = []
            if (this.telemetry) {
                removePromises.push(this.telemetry.flush())
            }
            if (this.queueManager && this.redisSubscriber) {
                removePromises.push(this.redisSubscriber.disconnect())
            }
            if (this.cachePool) {
                removePromises.push(this.cachePool.close())
            }
            if (this.server?.listening) {
                removePromises.push(
                    new Promise<void>((resolve, reject) => {
                        this.server?.close((error) => {
                            if (error) return reject(error)
                            resolve()
                        })
                    })
                )
            }
            await Promise.all(removePromises)
            if (this.AppDataSource?.isInitialized) {
                await this.AppDataSource.destroy()
            }
        } catch (e) {
            logger.error(`❌[server]: Flowise Server shut down error: ${e}`)
        }
    }
}

let serverApp: App | undefined

export async function start(): Promise<void> {
    serverApp = new App()

    const host = process.env.HOST
    const port = parseInt(process.env.PORT || '', 10) || 3000
    const server = http.createServer(serverApp.app)
    serverApp.server = server

    await serverApp.initDatabase()
    await serverApp.config()

    server.listen(port, host, () => {
        logger.info(`⚡️ [server]: Flowise Server is listening at ${host ? 'http://' + host : ''}:${port}`)
    })
}

export function getInstance(): App | undefined {
    return serverApp
}

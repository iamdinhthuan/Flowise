import { DataSource } from 'typeorm'
import { Organization } from '../enterprise/database/entities/organization.entity'
import { Workspace } from '../enterprise/database/entities/workspace.entity'
import { LoggedInUser } from '../enterprise/Interface.Enterprise'
import logger from './logger'

/**
 * Bootstrap and return a default LoggedInUser for Open Source deployments.
 *
 * On first call the function creates a default Organization + Workspace if
 * none exist, then caches and returns a synthetic user that has full admin
 * permissions.  Subsequent calls return the cached user immediately.
 */
let _cachedUser: Partial<LoggedInUser> | undefined

export async function getOrCreateOpenSourceUser(appDataSource: DataSource): Promise<Partial<LoggedInUser>> {
    if (_cachedUser) return _cachedUser

    let ws = await appDataSource.getRepository(Workspace).findOne({ where: {} })

    // If no workspace exists, bootstrap org + workspace directly (no account needed)
    if (!ws) {
        const dummyId = '00000000-0000-0000-0000-000000000000'
        const isSQLite = !process.env.DATABASE_TYPE || process.env.DATABASE_TYPE === 'sqlite'

        // Disable FK checks for bootstrap (dummy createdBy/updatedBy)
        try {
            if (isSQLite) {
                await appDataSource.query('PRAGMA foreign_keys = OFF')
            } else {
                await appDataSource.query('SET session_replication_role = replica')
            }
        } catch (_) {}

        const orgRepo = appDataSource.getRepository(Organization)
        let org = await orgRepo.findOne({ where: {} })
        if (!org) {
            org = orgRepo.create({
                name: 'Default Organization',
                createdBy: dummyId,
                updatedBy: dummyId
            })
            await orgRepo.save(org)
            logger.info(`🏢 [server]: Default Organization created: ${org.id}`)
        }

        const wsRepo = appDataSource.getRepository(Workspace)
        ws = wsRepo.create({
            name: 'Default Workspace',
            organizationId: org.id,
            createdBy: dummyId,
            updatedBy: dummyId
        })
        await wsRepo.save(ws)
        logger.info(`📁 [server]: Default Workspace created: ${ws.id}`)

        // Re-enable FK checks
        try {
            if (isSQLite) {
                await appDataSource.query('PRAGMA foreign_keys = ON')
            } else {
                await appDataSource.query('SET session_replication_role = DEFAULT')
            }
        } catch (_) {}
    }

    if (ws) {
        const org = await appDataSource.getRepository(Organization).findOne({
            where: { id: ws.organizationId }
        })
        _cachedUser = {
            id: '',
            permissions: [],
            features: {},
            activeOrganizationId: org?.id || '',
            activeOrganizationSubscriptionId: '',
            activeOrganizationCustomerId: '',
            activeOrganizationProductId: '',
            isOrganizationAdmin: true,
            activeWorkspaceId: ws.id,
            activeWorkspace: ws.name
        }
    }

    return _cachedUser!
}

/**
 * Reset the cached user — useful in tests or when the workspace changes.
 */
export function resetOpenSourceUserCache(): void {
    _cachedUser = undefined
}

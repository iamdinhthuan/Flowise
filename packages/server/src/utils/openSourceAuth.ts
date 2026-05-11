import { DataSource } from 'typeorm'
import { OrganizationUser, OrganizationUserStatus } from '../enterprise/database/entities/organization-user.entity'
import { Organization } from '../enterprise/database/entities/organization.entity'
import { GeneralRole, Role } from '../enterprise/database/entities/role.entity'
import { User, UserStatus } from '../enterprise/database/entities/user.entity'
import { WorkspaceUser, WorkspaceUserStatus } from '../enterprise/database/entities/workspace-user.entity'
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

const OPEN_SOURCE_SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
const OPEN_SOURCE_SYSTEM_USER_EMAIL = 'open-source-system@flowise.local'

async function getOrCreateOpenSourceSystemUser(appDataSource: DataSource): Promise<User> {
    const userRepo = appDataSource.getRepository(User)
    let user = await userRepo.findOne({ where: { id: OPEN_SOURCE_SYSTEM_USER_ID } })
    if (!user) {
        user = await userRepo.findOne({ where: { email: OPEN_SOURCE_SYSTEM_USER_EMAIL } })
    }
    if (user) return user

    user = userRepo.create({
        id: OPEN_SOURCE_SYSTEM_USER_ID,
        name: 'Open Source System User',
        email: OPEN_SOURCE_SYSTEM_USER_EMAIL,
        status: UserStatus.ACTIVE,
        createdBy: OPEN_SOURCE_SYSTEM_USER_ID,
        updatedBy: OPEN_SOURCE_SYSTEM_USER_ID
    })
    return await userRepo.save(user)
}

async function ensureOpenSourceMemberships(
    appDataSource: DataSource,
    systemUser: User,
    org: Organization,
    ws: Workspace
): Promise<string[]> {
    const ownerRoles = await appDataSource.getRepository(Role).find({
        where: { name: GeneralRole.OWNER }
    })
    const ownerRole = ownerRoles.find((role) => !role.organizationId) ?? ownerRoles[0]
    if (!ownerRole) {
        logger.warn('[server]: Open Source owner role not found; continuing with synthetic admin user.')
        return []
    }

    const organizationUserRepo = appDataSource.getRepository(OrganizationUser)
    const existingOrganizationUser = await organizationUserRepo.findOne({
        where: { organizationId: org.id, userId: systemUser.id }
    })
    if (!existingOrganizationUser) {
        await organizationUserRepo.save(
            organizationUserRepo.create({
                organizationId: org.id,
                userId: systemUser.id,
                roleId: ownerRole.id,
                status: OrganizationUserStatus.ACTIVE,
                createdBy: systemUser.id,
                updatedBy: systemUser.id
            })
        )
    }

    const workspaceUserRepo = appDataSource.getRepository(WorkspaceUser)
    const existingWorkspaceUser = await workspaceUserRepo.findOne({
        where: { workspaceId: ws.id, userId: systemUser.id }
    })
    if (!existingWorkspaceUser) {
        await workspaceUserRepo.save(
            workspaceUserRepo.create({
                workspaceId: ws.id,
                userId: systemUser.id,
                roleId: ownerRole.id,
                status: WorkspaceUserStatus.ACTIVE,
                createdBy: systemUser.id,
                updatedBy: systemUser.id
            })
        )
    }

    try {
        return JSON.parse(ownerRole.permissions || '[]')
    } catch (error) {
        logger.warn('[server]: Open Source owner role permissions are invalid JSON; continuing with empty permissions.', { error })
        return []
    }
}

export async function getOrCreateOpenSourceUser(appDataSource: DataSource): Promise<Partial<LoggedInUser>> {
    if (_cachedUser) return _cachedUser

    const systemUser = await getOrCreateOpenSourceSystemUser(appDataSource)
    let ws = await appDataSource.getRepository(Workspace).findOne({ where: {} })
    let org = ws?.organizationId
        ? await appDataSource.getRepository(Organization).findOne({
              where: { id: ws.organizationId }
          })
        : undefined

    if (!org) {
        const orgRepo = appDataSource.getRepository(Organization)
        org =
            (await orgRepo.findOne({ where: {} })) ||
            orgRepo.create({
                name: 'Default Organization',
                createdBy: systemUser.id,
                updatedBy: systemUser.id
            })
        if (!org.id) {
            org = await orgRepo.save(org)
            logger.info(`🏢 [server]: Default Organization created: ${org.id}`)
        }
    }

    // If no workspace exists, bootstrap org + workspace using a real system user
    // instead of disabling FK checks or writing dangling audit references.
    if (!ws) {
        const wsRepo = appDataSource.getRepository(Workspace)
        ws = wsRepo.create({
            name: 'Default Workspace',
            organizationId: org.id,
            createdBy: systemUser.id,
            updatedBy: systemUser.id
        })
        await wsRepo.save(ws)
        logger.info(`📁 [server]: Default Workspace created: ${ws.id}`)
    }

    if (ws) {
        const permissions = org ? await ensureOpenSourceMemberships(appDataSource, systemUser, org, ws) : []
        _cachedUser = {
            id: systemUser.id,
            email: systemUser.email,
            name: systemUser.name,
            permissions,
            features: {},
            activeOrganizationId: org?.id || '',
            activeOrganizationSubscriptionId: '',
            activeOrganizationCustomerId: '',
            activeOrganizationProductId: '',
            isOrganizationAdmin: true,
            activeWorkspaceId: ws.id,
            activeWorkspace: ws.name,
            assignedWorkspaces: org
                ? [
                      {
                          id: ws.id,
                          name: ws.name,
                          role: GeneralRole.OWNER,
                          organizationId: org.id
                      }
                  ]
                : []
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

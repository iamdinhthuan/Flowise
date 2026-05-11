jest.mock('./logger', () => ({
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}))

import { OrganizationUser } from '../enterprise/database/entities/organization-user.entity'
import { Organization } from '../enterprise/database/entities/organization.entity'
import { GeneralRole, Role } from '../enterprise/database/entities/role.entity'
import { User } from '../enterprise/database/entities/user.entity'
import { WorkspaceUser } from '../enterprise/database/entities/workspace-user.entity'
import { Workspace } from '../enterprise/database/entities/workspace.entity'
import { getOrCreateOpenSourceUser, resetOpenSourceUserCache } from './openSourceAuth'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

type RepoMock = {
    rows: any[]
    findOne: jest.Mock
    find: jest.Mock
    create: jest.Mock
    save: jest.Mock
}

const matchesWhere = (row: Record<string, any>, where: Record<string, any>): boolean => {
    return Object.entries(where).every(([key, value]) => {
        if (value && typeof value === 'object') return row[key] == null
        return row[key] === value
    })
}

const createRepo = (rows: any[] = [], idPrefix: string): RepoMock => ({
    rows,
    findOne: jest.fn(async ({ where }) => rows.find((row) => matchesWhere(row, where)) ?? null),
    find: jest.fn(async ({ where }) => rows.filter((row) => matchesWhere(row, where))),
    create: jest.fn((data) => ({ ...data })),
    save: jest.fn(async (entity) => {
        const saved = { ...entity, id: entity.id || `${idPrefix}-${rows.length + 1}` }
        rows.push(saved)
        return saved
    })
})

describe('getOrCreateOpenSourceUser', () => {
    beforeEach(() => {
        resetOpenSourceUserCache()
        jest.clearAllMocks()
    })

    it('bootstraps with real FK targets instead of disabling constraints', async () => {
        const userRepo = createRepo([], 'user')
        const organizationRepo = createRepo([], 'org')
        const workspaceRepo = createRepo([], 'workspace')
        const roleRepo = createRepo(
            [{ id: 'role-owner', name: GeneralRole.OWNER, organizationId: null, permissions: '["organization","workspace"]' }],
            'role'
        )
        const organizationUserRepo = createRepo([], 'organization-user')
        const workspaceUserRepo = createRepo([], 'workspace-user')
        const query = jest.fn()
        const repos = new Map<any, RepoMock>([
            [User, userRepo],
            [Organization, organizationRepo],
            [Workspace, workspaceRepo],
            [Role, roleRepo],
            [OrganizationUser, organizationUserRepo],
            [WorkspaceUser, workspaceUserRepo]
        ])
        const dataSource = {
            query,
            getRepository: jest.fn((entity) => repos.get(entity))
        }

        const user = await getOrCreateOpenSourceUser(dataSource as any)

        expect(query).not.toHaveBeenCalled()
        expect(userRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({
                id: SYSTEM_USER_ID,
                createdBy: SYSTEM_USER_ID,
                updatedBy: SYSTEM_USER_ID
            })
        )
        expect(organizationRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({ createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID })
        )
        expect(workspaceRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({ createdBy: SYSTEM_USER_ID, updatedBy: SYSTEM_USER_ID })
        )
        expect(organizationUserRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({ userId: SYSTEM_USER_ID, roleId: 'role-owner' })
        )
        expect(workspaceUserRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({ userId: SYSTEM_USER_ID, roleId: 'role-owner' })
        )
        expect(user.id).toBe(SYSTEM_USER_ID)
        expect(user.permissions).toEqual(['organization', 'workspace'])
    })
})

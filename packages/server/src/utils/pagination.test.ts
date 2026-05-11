import { Request } from 'express'
import { getPageAndLimitParams } from './pagination'

const makeReq = (query: Record<string, string>): Request => ({ query }) as unknown as Request

describe('getPageAndLimitParams', () => {
    it('defaults to unpaginated when no params are present', () => {
        expect(getPageAndLimitParams(makeReq({}))).toEqual({ page: -1, limit: -1 })
    })

    it('parses valid page and limit params', () => {
        expect(getPageAndLimitParams(makeReq({ page: '2', limit: '50' }))).toEqual({ page: 2, limit: 50 })
    })

    it('rejects non-numeric page and limit values', () => {
        expect(() => getPageAndLimitParams(makeReq({ page: 'abc' }))).toThrow('page cannot be negative')
        expect(() => getPageAndLimitParams(makeReq({ limit: 'abc' }))).toThrow('limit cannot be negative')
    })
})

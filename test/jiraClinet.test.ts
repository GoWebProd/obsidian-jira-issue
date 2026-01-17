import * as obsidian from 'obsidian'
import JiraClient from '../src/client/jiraClient'
import { TestAccountOpen } from './testData'

const kIssueKey = 'AAA-123'
const requestUrlMock = jest.spyOn(obsidian, 'requestUrl')
const defaultHeaders = { 'content-type': 'application/json' }

describe('JiraClient', () => {
    describe('Positive tests', () => {
        // test('getIssue minimal', async () => {
        //     requestUrlMock.mockReturnValue({ status: 200, json: {} } as any)
        //     expect(await JiraClient.getIssue(kIssueKey)).toEqual(true)
        //     expect(requestUrlMock.mock.calls[0][0]).toEqual({
        //         contentType: 'application/json',
        //         headers: {},
        //         method: 'GET',
        //         url: 'https://test-company.atlassian.net/rest/api/latest/project',
        //     })
        // })

        test('testConnection', async () => {
            requestUrlMock.mockReturnValue({ status: 200, headers: defaultHeaders, json: { issues: [] } } as any)
            expect(await JiraClient.testConnection(TestAccountOpen)).toEqual(true)
            expect(requestUrlMock.mock.calls[0][0]).toEqual({
                contentType: 'application/json',
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "obsidian-jira-issue-plugin",
                    "X-Atlassian-Token": "no-check",
                },
                method: 'GET',
                url: 'https://test-company.atlassian.net/rest/api/latest/project',
            })
        })

        test('getIssueTransitions returns transitions array', async () => {
            const mockTransitions = [
                { id: '11', name: 'To Do', to: { id: '1', name: 'To Do' } },
                { id: '21', name: 'In Progress', to: { id: '2', name: 'In Progress' } },
                { id: '31', name: 'Done', to: { id: '3', name: 'Done' } },
            ]
            requestUrlMock.mockReturnValue({
                status: 200,
                headers: defaultHeaders,
                json: { transitions: mockTransitions }
            } as any)

            const result = await JiraClient.getIssueTransitions(kIssueKey, { account: TestAccountOpen })

            expect(result).toEqual(mockTransitions)
            expect(requestUrlMock.mock.calls[0][0]).toEqual({
                contentType: 'application/json',
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "obsidian-jira-issue-plugin",
                    "X-Atlassian-Token": "no-check",
                },
                method: 'GET',
                url: 'https://test-company.atlassian.net/rest/api/latest/issue/AAA-123/transitions?expand=transitions.fields',
            })
        })

        test('getIssueTransitions returns empty array when no transitions', async () => {
            requestUrlMock.mockReturnValue({
                status: 200,
                headers: defaultHeaders,
                json: {}
            } as any)

            const result = await JiraClient.getIssueTransitions(kIssueKey, { account: TestAccountOpen })

            expect(result).toEqual([])
        })

        test('transitionIssue sends POST request with transition id', async () => {
            requestUrlMock.mockReturnValue({
                status: 204,
                headers: defaultHeaders,
            } as any)

            await JiraClient.transitionIssue(kIssueKey, '21', undefined, { account: TestAccountOpen })

            expect(requestUrlMock.mock.calls[0][0]).toEqual({
                contentType: 'application/json',
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "obsidian-jira-issue-plugin",
                    "X-Atlassian-Token": "no-check",
                },
                method: 'POST',
                url: 'https://test-company.atlassian.net/rest/api/latest/issue/AAA-123/transitions',
                body: JSON.stringify({ transition: { id: '21' } }),
            })
        })

        test('transitionIssue sends POST request with transition id and fields', async () => {
            requestUrlMock.mockReturnValue({
                status: 204,
                headers: defaultHeaders,
            } as any)

            const transitionFields = {
                resolution: { name: 'Done' },
                comment: { body: 'Completed the task' }
            }

            await JiraClient.transitionIssue(kIssueKey, '31', transitionFields, { account: TestAccountOpen })

            expect(requestUrlMock.mock.calls[0][0]).toEqual({
                contentType: 'application/json',
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "obsidian-jira-issue-plugin",
                    "X-Atlassian-Token": "no-check",
                },
                method: 'POST',
                url: 'https://test-company.atlassian.net/rest/api/latest/issue/AAA-123/transitions',
                body: JSON.stringify({
                    transition: { id: '31' },
                    fields: transitionFields
                }),
            })
        })
    })

    describe('Negative tests', () => {
        test('testConnection', async () => {
            expect.assertions(2)
            requestUrlMock.mockReturnValue({ status: 401, headers: defaultHeaders } as any)
            try {
                await JiraClient.testConnection(TestAccountOpen)
            } catch (e) {
                expect(e).toEqual(new Error(`Unauthorized: Please check your authentication credentials`))
                expect(requestUrlMock.mock.calls[0][0]).toEqual({
                    contentType: 'application/json',
                    headers: {
                        "Accept": "application/json",
                        "User-Agent": "obsidian-jira-issue-plugin",
                        "X-Atlassian-Token": "no-check",
                    },
                    method: 'GET',
                    url: 'https://test-company.atlassian.net/rest/api/latest/project',
                })
            }
        })

        test('getIssueTransitions throws error on 404', async () => {
            expect.assertions(2)
            requestUrlMock.mockReturnValue({ status: 404, headers: defaultHeaders } as any)
            try {
                await JiraClient.getIssueTransitions(kIssueKey, { account: TestAccountOpen })
            } catch (e) {
                expect(e).toEqual(new Error(`Not Found: Issue does not exist`))
                expect(requestUrlMock.mock.calls[0][0]).toEqual({
                    contentType: 'application/json',
                    headers: {
                        "Accept": "application/json",
                        "User-Agent": "obsidian-jira-issue-plugin",
                        "X-Atlassian-Token": "no-check",
                    },
                    method: 'GET',
                    url: 'https://test-company.atlassian.net/rest/api/latest/issue/AAA-123/transitions?expand=transitions.fields',
                })
            }
        })

        test('transitionIssue throws error on 400 bad request', async () => {
            expect.assertions(2)
            requestUrlMock.mockReturnValue({ status: 400, headers: defaultHeaders } as any)
            try {
                await JiraClient.transitionIssue(kIssueKey, 'invalid-id', undefined, { account: TestAccountOpen })
            } catch (e) {
                expect(e).toEqual(new Error(`Bad Request: The query is not valid`))
                expect(requestUrlMock.mock.calls[0][0]).toEqual({
                    contentType: 'application/json',
                    headers: {
                        "Accept": "application/json",
                        "User-Agent": "obsidian-jira-issue-plugin",
                        "X-Atlassian-Token": "no-check",
                    },
                    method: 'POST',
                    url: 'https://test-company.atlassian.net/rest/api/latest/issue/AAA-123/transitions',
                    body: JSON.stringify({ transition: { id: 'invalid-id' } }),
                })
            }
        })
    })

    test.todo('getIssue')
    test.todo('getSearchResults')
    test.todo('updateStatusColorCache')
    test.todo('updateCustomFieldsCache')
    test.todo('getLoggedUser')
    test.todo('getDevStatus')

    afterEach(() => {
        jest.clearAllMocks()
    })
})

export { }
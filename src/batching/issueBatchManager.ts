import { IJiraIssue } from "../interfaces/issueInterfaces"
import { IJiraIssueAccountSettings } from "../interfaces/settingsInterfaces"
import JiraClient from "../client/jiraClient"
import ObjectsCache from "../objectsCache"
import { SettingsData } from "../settings"

interface BatchRequestOptions {
    compact?: boolean
    account?: IJiraIssueAccountSettings
    onSuccess: (issue: IJiraIssue) => void
    onError: (err: string) => void
}

interface BatchRequest {
    issueKey: string
    options: BatchRequestOptions
}

interface AccountBatchGroup {
    account: IJiraIssueAccountSettings | null
    issueKeys: string[]
    requests: Map<string, BatchRequest[]>
}

const MAX_BATCH_SIZE = 50

function getBatchDelayMs(): number {
    return SettingsData.batchDelayMs || 150
}

function isDebugEnabled(): boolean {
    return SettingsData.debugBatching || false
}

function log(...args: unknown[]): void {
    if (isDebugEnabled()) {
        console.log('[BatchManager]', ...args)
    }
}

/**
 * IssueBatchManager coordinates batch requests for Jira issues.
 *
 * Instead of making individual API calls for each issue key, this manager
 * collects all pending requests and groups them by account, then executes
 * a single JQL query per account: "key in (KEY-1, KEY-2, ...)"
 */
export class IssueBatchManager {
    private pendingRequests: Map<string, BatchRequest[]> = new Map()
    private batchTimer: NodeJS.Timeout | null = null

    registerIssue(issueKey: string, options: BatchRequestOptions): void {
        const accountKey = this.getAccountKey(options.account)

        if (!this.pendingRequests.has(accountKey)) {
            this.pendingRequests.set(accountKey, [])
        }

        this.pendingRequests.get(accountKey)!.push({
            issueKey,
            options
        })

        log(`Registered issue: ${issueKey} (account: ${accountKey})`)

        // Reset debounce timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer)
        }
        this.batchTimer = setTimeout(() => this.executeBatch(), getBatchDelayMs())
    }

    private async executeBatch(): Promise<void> {
        if (this.pendingRequests.size === 0) {
            return
        }

        log('Executing batch...')

        // Collect all requests by account
        const accountGroups = this.groupRequestsByAccount()

        log(`Grouped into ${accountGroups.length} account group(s)`)

        // Clear pending requests (we'll work with the grouped copy)
        this.pendingRequests.clear()
        this.batchTimer = null

        // Execute batch for each account group
        for (const group of accountGroups) {
            await this.processAccountGroup(group)
        }

        log('Batch execution complete')
    }

    private groupRequestsByAccount(): AccountBatchGroup[] {
        const groups = new Map<string, AccountBatchGroup>()

        for (const [accountKey, requests] of this.pendingRequests) {
            // Deduplicate issue keys within this account group
            const uniqueRequests = new Map<string, BatchRequest[]>()

            for (const req of requests) {
                if (!uniqueRequests.has(req.issueKey)) {
                    uniqueRequests.set(req.issueKey, [])
                }
                uniqueRequests.get(req.issueKey)!.push(req)
            }

            // Get the account from the first request (all requests in this group have the same account)
            const account = requests[0].options.account || null
            const issueKeys = Array.from(uniqueRequests.keys())

            groups.set(accountKey, {
                account,
                issueKeys,
                requests: uniqueRequests
            })
        }

        return Array.from(groups.values())
    }

    private async processAccountGroup(group: AccountBatchGroup): Promise<void> {
        const { account, issueKeys, requests } = group

        log(`Processing account group: ${account?.alias || 'fallback'} with ${issueKeys.length} issue(s)`)

        // First, check cache for each issue
        const uncachedKeys: string[] = []
        const uncachedRequests: Map<string, BatchRequest[]> = new Map()

        for (const key of issueKeys) {
            const keyRequests = requests.get(key)!
            const cachedIssue = ObjectsCache.get(key)

            if (cachedIssue) {
                log(`  ✓ Cache hit for ${key}`)
                // Render from cache
                for (const req of keyRequests) {
                    if (cachedIssue.isError) {
                        req.options.onError(cachedIssue.data as string)
                    } else {
                        req.options.onSuccess(cachedIssue.data as IJiraIssue)
                    }
                }
            } else {
                log(`  ✗ Cache miss for ${key} - will fetch`)
                // Mark for batch fetch
                uncachedKeys.push(key)
                uncachedRequests.set(key, keyRequests)
            }
        }

        // If all issues were cached, we're done
        if (uncachedKeys.length === 0) {
            log(`All ${issueKeys.length} issue(s) from cache`)
            return
        }

        log(`Fetching ${uncachedKeys.length} uncached issue(s) from API`)

        // Fetch uncached issues in batches
        await this.fetchUncachedIssues(account, uncachedKeys, uncachedRequests)
    }

    private async fetchUncachedIssues(
        account: IJiraIssueAccountSettings | null,
        issueKeys: string[],
        requests: Map<string, BatchRequest[]>
    ): Promise<void> {
        // Split into chunks if too many issues
        const chunks = this.chunkIssueKeys(issueKeys)

        for (const chunk of chunks) {
            await this.fetchBatchChunk(account, chunk, requests)
        }
    }

    private async fetchBatchChunk(
        account: IJiraIssueAccountSettings | null,
        issueKeys: string[],
        requests: Map<string, BatchRequest[]>
    ): Promise<void> {
        const jql = this.buildJQLQuery(issueKeys)

        log(`  → Batch JQL query: ${jql}`)

        try {
            const results = await JiraClient.getSearchResults(jql, {
                limit: issueKeys.length,
                account: account || undefined
            })

            log(`  ← Received ${results.issues.length}/${issueKeys.length} issue(s)`)

            // Create a map for quick lookup
            const issuesMap = new Map<string, IJiraIssue>()
            for (const issue of results.issues) {
                issuesMap.set(issue.key, issue)
                // Cache the result
                ObjectsCache.add(issue.key, issue)
            }

            // Render each request
            for (const key of issueKeys) {
                const keyRequests = requests.get(key)
                if (!keyRequests) continue

                const issue = issuesMap.get(key)
                if (issue) {
                    for (const req of keyRequests) {
                        req.options.onSuccess(issue)
                    }
                } else {
                    // Issue not found in results - might not exist or no access
                    const error = `Issue not found: ${key}`
                    log(`  ⚠ ${key} not found in results`)
                    for (const req of keyRequests) {
                        ObjectsCache.add(key, error, true)
                        req.options.onError(error)
                    }
                }
            }
        } catch (err) {
            // Batch request failed - mark all as errors
            const errorMessage = err instanceof Error ? err.message : String(err)
            log(`  ✗ Batch request failed: ${errorMessage}`)
            for (const key of issueKeys) {
                const keyRequests = requests.get(key)
                if (!keyRequests) continue

                for (const req of keyRequests) {
                    ObjectsCache.add(key, errorMessage, true)
                    req.options.onError(errorMessage)
                }
            }
        }
    }

    private buildJQLQuery(keys: string[]): string {
        return `key in (${keys.join(', ')})`
    }

    private chunkIssueKeys(keys: string[]): string[][] {
        const chunks: string[][] = []
        let currentChunk: string[] = []
        let currentLength = 0

        // Base JQL query length overhead: "key in (" + ")" = 10 chars
        const JQL_OVERHEAD = 10
        const MAX_JQL_LENGTH = 1500

        for (const key of keys) {
            // Check if adding this key would exceed limits
            const potentialLength = currentLength + key.length + (currentChunk.length > 0 ? 2 : 0) // +2 for ", "

            if (currentChunk.length >= MAX_BATCH_SIZE ||
                (currentChunk.length > 0 && potentialLength + JQL_OVERHEAD > MAX_JQL_LENGTH)) {
                chunks.push(currentChunk)
                currentChunk = []
                currentLength = 0
            }

            currentChunk.push(key)
            currentLength += key.length + (currentChunk.length > 1 ? 2 : 0)
        }

        if (currentChunk.length > 0) {
            chunks.push(currentChunk)
        }

        return chunks
    }

    private getAccountKey(account: IJiraIssueAccountSettings | null | undefined): string {
        return account?.alias || 'fallback'
    }

    /**
     * Cancel all pending requests (useful for cleanup)
     */
    cancel(): void {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer)
            this.batchTimer = null
        }
        this.pendingRequests.clear()
    }
}

// Global singleton for use in inlineIssueViewPlugin
let globalInstance: IssueBatchManager | null = null

export function getGlobalBatchManager(): IssueBatchManager {
    if (!globalInstance) {
        globalInstance = new IssueBatchManager()
    }
    return globalInstance
}

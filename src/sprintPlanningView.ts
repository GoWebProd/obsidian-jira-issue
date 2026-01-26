import { COMMENT_REGEX, IJiraIssueAccountSettings } from "./interfaces/settingsInterfaces"
import { getAccountByAlias } from "./utils"

export type EstimationType = 'story_points' | 'hours' | 'days'

export interface ICapacityConfig {
    [username: string]: number  // username -> capacity in estimation units
}

export class SprintPlanningView {
    boardId: number = null
    account: IJiraIssueAccountSettings = null
    estimationField: string = null  // e.g., 'customfield_10016' or 'timeoriginalestimate'
    estimationType: EstimationType = 'story_points'
    hoursPerDay: number = 8
    capacity: ICapacityConfig = {}
    excludeTypes: string[] = []  // Issue types to exclude (e.g., ['Epic', 'Story'])
    private _cacheKey: string = null

    static fromString(source: string): SprintPlanningView {
        const view = new SprintPlanningView()
        const lines = source.split('\n').filter(line => line.trim() && !COMMENT_REGEX.test(line))

        let inCapacityBlock = false

        for (const line of lines) {
            const trimmedLine = line.trim()
            const indentLevel = line.length - line.trimStart().length

            // Detect capacity block start
            if (trimmedLine.toLowerCase() === 'capacity:') {
                inCapacityBlock = true
                continue
            }

            // Inside capacity block - parse key: value pairs with indent
            if (inCapacityBlock && indentLevel > 0) {
                const colonIndex = trimmedLine.indexOf(':')
                if (colonIndex === -1) continue

                const username = trimmedLine.substring(0, colonIndex).trim()
                const capacityValue = parseFloat(trimmedLine.substring(colonIndex + 1).trim())

                if (!isNaN(capacityValue) && capacityValue >= 0) {
                    view.capacity[username] = capacityValue
                }
                continue
            }

            // Exit capacity block when hitting non-indented line
            if (inCapacityBlock && indentLevel === 0) {
                inCapacityBlock = false
            }

            // Top-level key-value pairs
            const colonIndex = trimmedLine.indexOf(':')
            if (colonIndex === -1) continue

            const key = trimmedLine.substring(0, colonIndex).trim().toLowerCase()
            const value = trimmedLine.substring(colonIndex + 1).trim()

            switch (key) {
                case 'board':
                    const boardIdValue = parseInt(value)
                    if (!isNaN(boardIdValue) && boardIdValue > 0) {
                        view.boardId = boardIdValue
                    }
                    break
                case 'account':
                    view.account = getAccountByAlias(value)
                    break
                case 'estimationfield':
                    view.estimationField = value
                    break
                case 'estimationtype':
                    const typeValue = value.toLowerCase()
                    if (typeValue === 'story_points' || typeValue === 'hours' || typeValue === 'days') {
                        view.estimationType = typeValue
                    }
                    break
                case 'hoursperday':
                    const hpd = parseInt(value)
                    if (!isNaN(hpd) && hpd > 0) {
                        view.hoursPerDay = hpd
                    }
                    break
                case 'excludetypes':
                    // Parse comma-separated list of issue types to exclude
                    view.excludeTypes = value.split(',').map(t => t.trim()).filter(t => t.length > 0)
                    break
            }
        }

        // Validation
        if (!view.boardId) {
            throw new Error('Board ID is required for jira-sprint-planning (use "board: 123")')
        }
        if (!view.estimationField) {
            throw new Error('Estimation field is required for jira-sprint-planning (use "estimationfield: customfield_10016")')
        }

        return view
    }

    getCacheKey(): string {
        if (!this._cacheKey) {
            this._cacheKey = `sprint-planning:${this.boardId}:${this.account?.alias || ''}`
        }
        return this._cacheKey
    }

    toRawString(): string {
        let result = `board: ${this.boardId}\n`

        if (this.account) {
            result += `account: ${this.account.alias}\n`
        }

        result += `estimationfield: ${this.estimationField}\n`
        result += `estimationtype: ${this.estimationType}\n`

        if (this.hoursPerDay !== 8) {
            result += `hoursperday: ${this.hoursPerDay}\n`
        }

        if (this.excludeTypes.length > 0) {
            result += `excludetypes: ${this.excludeTypes.join(', ')}\n`
        }

        if (Object.keys(this.capacity).length > 0) {
            result += '\ncapacity:\n'
            for (const [username, cap] of Object.entries(this.capacity)) {
                result += `  ${username}: ${cap}\n`
            }
        }

        return result
    }

    /**
     * Get total team capacity
     */
    getTotalCapacity(): number {
        return Object.values(this.capacity).reduce((sum, cap) => sum + cap, 0)
    }

    /**
     * Get capacity for a specific user (by displayName or username)
     */
    getUserCapacity(displayName: string): number | null {
        // Try exact match first
        if (displayName in this.capacity) {
            return this.capacity[displayName]
        }
        // Try case-insensitive match
        const lowerName = displayName.toLowerCase()
        for (const [key, value] of Object.entries(this.capacity)) {
            if (key.toLowerCase() === lowerName) {
                return value
            }
        }
        return null
    }

    /**
     * Format estimation value based on type
     */
    formatEstimation(value: number): string {
        if (!value) return '0'

        switch (this.estimationType) {
            case 'hours':
                return this.formatHours(value)
            case 'days':
                return this.formatDays(value)
            case 'story_points':
            default:
                return value % 1 !== 0 ? value.toFixed(1) : value.toString()
        }
    }

    private formatHours(hours: number): string {
        if (hours < this.hoursPerDay) {
            return `${Math.round(hours)}h`
        }
        const days = Math.floor(hours / this.hoursPerDay)
        const remainingHours = Math.round(hours % this.hoursPerDay)
        if (remainingHours > 0) {
            return `${days}d ${remainingHours}h`
        }
        return `${days}d`
    }

    private formatDays(days: number): string {
        return days % 1 !== 0 ? `${days.toFixed(1)}d` : `${days}d`
    }

    /**
     * Convert raw estimation value from Jira to display units
     * (e.g., seconds to hours for timeoriginalestimate)
     */
    normalizeEstimation(rawValue: number): number {
        if (!rawValue) return 0

        // timeoriginalestimate is stored in seconds
        if (this.estimationField === 'timeoriginalestimate' ||
            this.estimationField === 'timeestimate' ||
            this.estimationField === 'aggregatetimeoriginalestimate') {
            if (this.estimationType === 'hours') {
                return rawValue / 3600
            } else if (this.estimationType === 'days') {
                return rawValue / 3600 / this.hoursPerDay
            }
        }

        return rawValue
    }
}

import { MarkdownPostProcessorContext, Notice, setIcon } from "obsidian"
import { toDefaultedIssue, IJiraSearchResults, IJiraIssue, IJiraSprint, ESprintState } from "../interfaces/issueInterfaces"
import JiraClient from "../client/jiraClient"
import ObjectsCache from "../objectsCache"
import RC, { createAvatarPlaceholder, getPriorityColorClass } from "./renderingCommon"
import { SprintPlanningView } from "../sprintPlanningView"
import { SettingsData } from "../settings"
import { attachIssueClickHandler } from "./issueClickHandler"
import { attachIssueContextMenuHandler } from "./issueContextMenuHandler"
import { StartSprintModal, CapacitySettingsModal } from "../modals/startSprintModal"

interface ISprintPlanningData {
    sprint: IJiraSprint | null
    sprintIssues: IJiraIssue[]
    backlogIssues: IJiraIssue[]
}

interface ICapacityStats {
    displayName: string
    username: string
    avatarUrl?: string
    tasks: number
    assigned: number  // estimation units assigned
    capacity: number | null  // configured capacity (null if not set)
    isOverCapacity: boolean
}

interface IFilterState {
    assignee: string | null  // null = show all, 'unassigned' = unassigned, otherwise displayName
}

// Map to deduplicate concurrent loadSprintPlanningData calls
const loadingPromises: Map<string, Promise<ISprintPlanningData>> = new Map()

/**
 * Get estimation value from an issue field
 */
function getIssueEstimation(issue: IJiraIssue, fieldName: string, view: SprintPlanningView): number {
    const fields = issue.fields as Record<string, unknown>
    let rawValue = 0

    // Try direct field access
    if (fieldName in fields) {
        rawValue = Number(fields[fieldName]) || 0
    } else if (fields[fieldName]) {
        rawValue = Number(fields[fieldName]) || 0
    } else {
        // Try with customfield_ prefix
        const customFieldKey = fieldName.startsWith('customfield_') ? fieldName : `customfield_${fieldName}`
        if (fields[customFieldKey]) {
            rawValue = Number(fields[customFieldKey]) || 0
        }
    }

    return view.normalizeEstimation(rawValue)
}

/**
 * Calculate capacity statistics from sprint issues
 */
function calculateCapacityStats(issues: IJiraIssue[], view: SprintPlanningView): ICapacityStats[] {
    const statsMap = new Map<string, ICapacityStats>()

    for (const issue of issues) {
        const assignee = issue.fields.assignee
        const key = assignee?.accountId || assignee?.name || 'unassigned'
        const displayName = assignee?.displayName || 'Unassigned'

        if (!statsMap.has(key)) {
            statsMap.set(key, {
                displayName,
                username: assignee?.name || assignee?.accountId || '',
                avatarUrl: assignee?.avatarUrls?.['24x24'],
                tasks: 0,
                assigned: 0,
                capacity: view.getUserCapacity(displayName),
                isOverCapacity: false
            })
        }

        const stats = statsMap.get(key)!
        stats.tasks++
        stats.assigned += getIssueEstimation(issue, view.estimationField, view)
    }

    // Calculate overCapacity
    for (const stats of statsMap.values()) {
        if (stats.capacity !== null && stats.assigned > stats.capacity) {
            stats.isOverCapacity = true
        }
    }

    // Sort: unassigned last, then by name
    return Array.from(statsMap.values()).sort((a, b) => {
        if (a.displayName === 'Unassigned') return 1
        if (b.displayName === 'Unassigned') return -1
        return a.displayName.localeCompare(b.displayName)
    })
}

/**
 * Filter issues by excluding specified types
 */
function filterIssuesByType(issues: IJiraIssue[], excludeTypes: string[]): IJiraIssue[] {
    if (excludeTypes.length === 0) return issues
    const excludeTypesLower = excludeTypes.map(t => t.toLowerCase())
    return issues.filter(issue => {
        const typeName = issue.fields.issuetype?.name?.toLowerCase() || ''
        return !excludeTypesLower.includes(typeName)
    })
}

/**
 * Render a compact issue card for sprint planning
 */
function renderIssueCard(
    issue: IJiraIssue,
    view: SprintPlanningView,
    onIssueUpdated: (issue: IJiraIssue) => void,
    source: 'sprint' | 'backlog'
): HTMLElement {
    const card = createDiv({ cls: 'ji-sprint-card' })
    card.setAttribute('data-issue-key', issue.key)
    card.setAttribute('data-source', source)
    card.setAttribute('data-assignee', issue.fields.assignee?.displayName || 'unassigned')

    // Attach context menu
    attachIssueContextMenuHandler(card, issue, onIssueUpdated)

    // Make card draggable
    card.draggable = true
    card.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', issue.key)
        card.classList.add('ji-sprint-card-dragging')
    })
    card.addEventListener('dragend', () => {
        card.classList.remove('ji-sprint-card-dragging')
    })

    // Header: type icon + key
    const header = createDiv({ cls: 'ji-sprint-card-header' })

    if (issue.fields.issuetype?.iconUrl) {
        createEl('img', {
            cls: 'ji-sprint-card-type-icon',
            attr: { src: issue.fields.issuetype.iconUrl, alt: issue.fields.issuetype.name },
            title: issue.fields.issuetype.name,
            parent: header
        })
    }

    const keyLink = createEl('a', {
        cls: 'ji-sprint-card-key',
        text: issue.key,
        href: RC.issueUrl(issue.account, issue.key),
        title: issue.fields.summary,
        parent: header
    })
    attachIssueClickHandler(keyLink, issue)

    card.appendChild(header)

    // Summary
    createDiv({ cls: 'ji-sprint-card-summary', text: issue.fields.summary, parent: card })

    // Footer: assignee + estimation
    const footer = createDiv({ cls: 'ji-sprint-card-footer' })

    // Assignee
    if (issue.fields.assignee?.displayName) {
        if (issue.fields.assignee.avatarUrls?.['16x16']) {
            createEl('img', {
                cls: 'ji-sprint-card-avatar',
                attr: { src: issue.fields.assignee.avatarUrls['16x16'], alt: issue.fields.assignee.displayName },
                title: issue.fields.assignee.displayName,
                parent: footer
            })
        } else {
            const placeholder = createAvatarPlaceholder(issue.fields.assignee.displayName, 16)
            placeholder.addClass('ji-sprint-card-avatar')
            footer.appendChild(placeholder)
        }
        createSpan({ cls: 'ji-sprint-card-assignee', text: issue.fields.assignee.displayName, parent: footer })
    } else {
        createSpan({ cls: 'ji-sprint-card-assignee ji-unassigned', text: 'Unassigned', parent: footer })
    }

    // Estimation
    const estimation = getIssueEstimation(issue, view.estimationField, view)
    if (estimation > 0) {
        createSpan({
            cls: 'ji-sprint-card-estimation',
            text: view.formatEstimation(estimation),
            parent: footer
        })
    }

    card.appendChild(footer)

    return card
}

/**
 * Update an existing issue card's assignee section without full re-render
 */
function updateIssueCard(
    card: HTMLElement,
    issue: IJiraIssue,
    view: SprintPlanningView
): void {
    // Update data-assignee attribute
    card.setAttribute('data-assignee', issue.fields.assignee?.displayName || 'unassigned')

    // Find footer with assignee
    const footer = card.querySelector('.ji-sprint-card-footer')
    if (!footer) return

    // Remove existing assignee elements (avatar + name)
    footer.querySelectorAll('.ji-sprint-card-avatar, .ji-sprint-card-assignee').forEach(el => el.remove())

    // Find estimation element to insert before it
    const estimationEl = footer.querySelector('.ji-sprint-card-estimation')

    if (issue.fields.assignee?.displayName) {
        // Avatar
        if (issue.fields.assignee.avatarUrls?.['16x16']) {
            const avatar = createEl('img', {
                cls: 'ji-sprint-card-avatar',
                attr: { src: issue.fields.assignee.avatarUrls['16x16'], alt: issue.fields.assignee.displayName },
                title: issue.fields.assignee.displayName,
            })
            footer.insertBefore(avatar, estimationEl)
        } else {
            const placeholder = createAvatarPlaceholder(issue.fields.assignee.displayName, 16)
            placeholder.addClass('ji-sprint-card-avatar')
            footer.insertBefore(placeholder, estimationEl)
        }
        // Name
        const nameSpan = createSpan({ cls: 'ji-sprint-card-assignee', text: issue.fields.assignee.displayName })
        footer.insertBefore(nameSpan, estimationEl)
    } else {
        const unassigned = createSpan({ cls: 'ji-sprint-card-assignee ji-unassigned', text: 'Unassigned' })
        footer.insertBefore(unassigned, estimationEl)
    }
}

/**
 * Render capacity card for a team member
 */
function renderCapacityCard(
    stats: ICapacityStats,
    view: SprintPlanningView,
    onFilterClick?: (displayName: string) => void
): HTMLElement {
    const card = createDiv({ cls: `ji-capacity-card ${stats.isOverCapacity ? 'ji-over-capacity' : ''}` })
    card.setAttribute('data-assignee-filter', stats.displayName)

    // Make clickable for filtering
    if (onFilterClick) {
        card.classList.add('ji-capacity-card-clickable')
        card.addEventListener('click', () => onFilterClick(stats.displayName))
    }

    // Avatar
    if (stats.avatarUrl) {
        createEl('img', {
            cls: 'ji-capacity-avatar',
            attr: { src: stats.avatarUrl, alt: stats.displayName },
            parent: card
        })
    } else if (stats.displayName !== 'Unassigned') {
        const placeholder = createAvatarPlaceholder(stats.displayName, 32)
        placeholder.addClass('ji-capacity-avatar')
        card.appendChild(placeholder)
    } else {
        const warningIcon = createDiv({ cls: 'ji-capacity-avatar ji-capacity-unassigned-icon', parent: card })
        setIcon(warningIcon, 'user-x')
    }

    // Name
    createDiv({ cls: 'ji-capacity-name', text: stats.displayName, parent: card })

    // Tasks count
    createDiv({ cls: 'ji-capacity-tasks', text: `${stats.tasks} task${stats.tasks !== 1 ? 's' : ''}`, parent: card })

    // Capacity usage
    const capacityRow = createDiv({ cls: 'ji-capacity-usage', parent: card })
    const assignedFormatted = view.formatEstimation(stats.assigned)

    if (stats.capacity !== null) {
        const capacityFormatted = view.formatEstimation(stats.capacity)
        createSpan({ text: `${assignedFormatted} / ${capacityFormatted}`, parent: capacityRow })

        if (stats.isOverCapacity) {
            const warningSpan = createSpan({ cls: 'ji-capacity-warning', parent: capacityRow })
            setIcon(warningSpan, 'alert-triangle')
        }

        // Progress bar
        const progressBar = createDiv({ cls: 'ji-capacity-bar', parent: card })
        const percent = Math.min(100, (stats.assigned / stats.capacity) * 100)
        createDiv({
            cls: `ji-capacity-bar-fill ${stats.isOverCapacity ? 'ji-over-capacity' : ''}`,
            attr: { style: `width: ${percent}%` },
            parent: progressBar
        })
    } else {
        createSpan({ text: assignedFormatted, parent: capacityRow })
    }

    return card
}

/**
 * Update capacity section without full re-render
 */
function updateCapacitySection(
    board: HTMLElement,
    sprintIssues: IJiraIssue[],
    view: SprintPlanningView
): void {
    const capacitySection = board.querySelector('.ji-sprint-planning-capacity')
    if (!capacitySection) return

    // Recalculate stats
    const capacityStats = calculateCapacityStats(sprintIssues, view)

    // Re-render capacity cards
    const capacityCards = capacitySection.querySelector('.ji-capacity-cards')
    if (capacityCards) {
        capacityCards.empty()
        for (const stats of capacityStats) {
            capacityCards.appendChild(renderCapacityCard(stats, view))
        }
    }

    // Update total row
    const totalAssigned = capacityStats.reduce((sum, s) => sum + s.assigned, 0)
    const totalCapacity = view.getTotalCapacity()
    const totalTasks = capacityStats.reduce((sum, s) => sum + s.tasks, 0)
    const isOverTotal = totalCapacity > 0 && totalAssigned > totalCapacity

    const totalRow = capacitySection.querySelector('.ji-capacity-total')
    if (totalRow) {
        totalRow.empty()
        totalRow.classList.toggle('ji-over-capacity', isOverTotal)

        let totalText = `Total: ${totalTasks} task${totalTasks !== 1 ? 's' : ''}, ${view.formatEstimation(totalAssigned)}`
        if (totalCapacity > 0) {
            totalText += ` / ${view.formatEstimation(totalCapacity)} capacity`
        }
        createSpan({ text: totalText, parent: totalRow })
        if (isOverTotal) {
            const warningSpan = createSpan({ cls: 'ji-capacity-warning', parent: totalRow })
            setIcon(warningSpan, 'alert-triangle')
        }
    }
}

/**
 * Apply assignee filter to issue cards
 */
function applyAssigneeFilter(
    board: HTMLElement,
    filterState: IFilterState
): void {
    const cards = board.querySelectorAll('.ji-sprint-card')
    cards.forEach(card => {
        const cardAssignee = card.getAttribute('data-assignee')
        if (filterState.assignee === null) {
            // Show all
            card.classList.remove('ji-sprint-card-filtered')
        } else if (filterState.assignee === 'Unassigned') {
            // Show only unassigned
            card.classList.toggle('ji-sprint-card-filtered', cardAssignee !== 'unassigned')
        } else {
            // Show only specific assignee
            card.classList.toggle('ji-sprint-card-filtered', cardAssignee !== filterState.assignee)
        }
    })

    // Update capacity cards active state
    const capacityCards = board.querySelectorAll('.ji-capacity-card')
    capacityCards.forEach(card => {
        const cardFilter = card.getAttribute('data-assignee-filter')
        card.classList.toggle('ji-capacity-card-active', cardFilter === filterState.assignee)
    })
}

/**
 * Render the sprint planning board
 */
function renderSprintPlanningBoard(
    rootEl: HTMLElement,
    view: SprintPlanningView,
    data: ISprintPlanningData
): void {
    const board = createDiv({ cls: `ji-sprint-planning ${RC.getTheme()}` })

    // Apply type filter
    const filteredSprintIssues = filterIssuesByType(data.sprintIssues, view.excludeTypes)
    const filteredBacklogIssues = filterIssuesByType(data.backlogIssues, view.excludeTypes)

    // Filter state
    const filterState: IFilterState = { assignee: null }

    // Callback for issue updates - optimistic update without full re-render
    const onIssueUpdated = (updatedIssue: IJiraIssue): void => {
        // 1. Find and update the card in DOM
        const card = rootEl.querySelector(`[data-issue-key="${updatedIssue.key}"]`) as HTMLElement
        if (card) {
            updateIssueCard(card, updatedIssue, view)
        }

        // 2. Update data in memory
        const issueInSprint = data.sprintIssues.find(i => i.key === updatedIssue.key)
        const issueInBacklog = data.backlogIssues.find(i => i.key === updatedIssue.key)

        if (issueInSprint) {
            Object.assign(issueInSprint, updatedIssue)
        } else if (issueInBacklog) {
            Object.assign(issueInBacklog, updatedIssue)
        }

        // 3. Update capacity section if issue is in sprint (use filtered list)
        if (issueInSprint) {
            updateCapacitySection(board, filterIssuesByType(data.sprintIssues, view.excludeTypes), view)
        }

        // 4. Update cache with modified data
        ObjectsCache.add(view.getCacheKey(), data)
    }

    // Callback for refresh
    const refreshBoard = (): void => {
        ObjectsCache.delete(view.getCacheKey())
        rootEl.empty()
        SprintPlanningFenceRenderer(view.toRawString(), rootEl, null)
    }

    // Header
    const header = createDiv({ cls: 'ji-sprint-planning-header', parent: board })

    const titleSection = createDiv({ cls: 'ji-sprint-planning-title-section', parent: header })
    if (data.sprint) {
        createEl('h3', { text: `Sprint: ${data.sprint.name}`, cls: 'ji-sprint-planning-title', parent: titleSection })
        if (data.sprint.goal) {
            createDiv({ text: `Goal: ${data.sprint.goal}`, cls: 'ji-sprint-planning-goal', parent: titleSection })
        }
    } else {
        createEl('h3', { text: 'No Future Sprint', cls: 'ji-sprint-planning-title', parent: titleSection })
        createDiv({ text: 'Create a sprint in Jira to start planning', cls: 'ji-sprint-planning-goal', parent: titleSection })
    }

    // Buttons section
    const buttonsSection = createDiv({ cls: 'ji-sprint-planning-buttons', parent: header })

    if (data.sprint && data.sprint.state === ESprintState.FUTURE) {
        const startBtn = createEl('button', {
            text: 'Start Sprint',
            cls: 'ji-sprint-btn ji-sprint-btn-primary',
            parent: buttonsSection
        })
        startBtn.addEventListener('click', () => {
            new StartSprintModal(data.sprint!, view.account, refreshBoard).open()
        })
    }

    const capacityBtn = createEl('button', {
        cls: 'ji-sprint-btn ji-sprint-btn-secondary',
        parent: buttonsSection
    })
    setIcon(capacityBtn, 'settings')
    capacityBtn.title = 'Capacity Settings'
    capacityBtn.addEventListener('click', () => {
        const assignees = data.sprintIssues
            .map(i => i.fields.assignee)
            .filter(a => a?.displayName)
            .map(a => ({ displayName: a.displayName, username: a.name || a.accountId || '' }))
            .filter((v, i, arr) => arr.findIndex(x => x.displayName === v.displayName) === i)

        new CapacitySettingsModal(view.capacity, assignees, (newCapacity) => {
            view.capacity = newCapacity
            // Re-render to show updated capacity
            renderSprintPlanningBoard(rootEl, view, data)
        }).open()
    })

    // Callback for assignee filter
    const onFilterClick = (displayName: string): void => {
        // Toggle filter: if same assignee clicked, clear filter
        if (filterState.assignee === displayName) {
            filterState.assignee = null
        } else {
            filterState.assignee = displayName
        }
        applyAssigneeFilter(board, filterState)
    }

    // Capacity Section
    if (filteredSprintIssues.length > 0) {
        const capacitySection = createDiv({ cls: 'ji-sprint-planning-capacity', parent: board })
        const capacityHeader = createDiv({ cls: 'ji-sprint-section-header', parent: capacitySection })
        createEl('h4', { text: 'Team Capacity', cls: 'ji-sprint-section-title', parent: capacityHeader })

        // Clear filter button (hidden by default)
        const clearFilterBtn = createEl('button', {
            text: 'Show All',
            cls: 'ji-sprint-btn ji-sprint-btn-small ji-filter-clear-btn',
            parent: capacityHeader
        })
        clearFilterBtn.style.display = 'none'
        clearFilterBtn.addEventListener('click', () => {
            filterState.assignee = null
            applyAssigneeFilter(board, filterState)
            clearFilterBtn.style.display = 'none'
        })

        const capacityStats = calculateCapacityStats(filteredSprintIssues, view)
        const capacityCards = createDiv({ cls: 'ji-capacity-cards', parent: capacitySection })

        for (const stats of capacityStats) {
            capacityCards.appendChild(renderCapacityCard(stats, view, (displayName) => {
                onFilterClick(displayName)
                clearFilterBtn.style.display = filterState.assignee ? 'inline-block' : 'none'
            }))
        }

        // Total summary
        const totalAssigned = capacityStats.reduce((sum, s) => sum + s.assigned, 0)
        const totalCapacity = view.getTotalCapacity()
        const totalTasks = capacityStats.reduce((sum, s) => sum + s.tasks, 0)
        const isOverTotal = totalCapacity > 0 && totalAssigned > totalCapacity

        const totalRow = createDiv({ cls: `ji-capacity-total ${isOverTotal ? 'ji-over-capacity' : ''}`, parent: capacitySection })
        let totalText = `Total: ${totalTasks} task${totalTasks !== 1 ? 's' : ''}, ${view.formatEstimation(totalAssigned)}`
        if (totalCapacity > 0) {
            totalText += ` / ${view.formatEstimation(totalCapacity)} capacity`
        }
        createSpan({ text: totalText, parent: totalRow })
        if (isOverTotal) {
            const warningSpan = createSpan({ cls: 'ji-capacity-warning', parent: totalRow })
            setIcon(warningSpan, 'alert-triangle')
        }
    }

    // Backlogs Section
    const backlogsSection = createDiv({ cls: 'ji-sprint-planning-backlogs', parent: board })

    // Sprint Backlog
    const sprintBacklog = createDiv({ cls: 'ji-sprint-backlog', parent: backlogsSection })
    createEl('h4', {
        text: `Sprint Backlog (${filteredSprintIssues.length})`,
        cls: 'ji-sprint-section-title',
        parent: sprintBacklog
    })

    const sprintList = createDiv({ cls: 'ji-sprint-list', parent: sprintBacklog })
    setupDropZone(sprintList, 'sprint', data.sprint?.id || 0, view, rootEl, refreshBoard)

    for (const issue of filteredSprintIssues) {
        sprintList.appendChild(renderIssueCard(toDefaultedIssue(issue), view, onIssueUpdated, 'sprint'))
    }

    if (filteredSprintIssues.length === 0) {
        createDiv({ cls: 'ji-sprint-list-empty', text: 'Drag issues here to add to sprint', parent: sprintList })
    }

    // Product Backlog
    const productBacklog = createDiv({ cls: 'ji-product-backlog', parent: backlogsSection })
    createEl('h4', {
        text: `Backlog (${filteredBacklogIssues.length})`,
        cls: 'ji-sprint-section-title',
        parent: productBacklog
    })

    const backlogList = createDiv({ cls: 'ji-sprint-list', parent: productBacklog })
    setupDropZone(backlogList, 'backlog', view.boardId, view, rootEl, refreshBoard)

    for (const issue of filteredBacklogIssues) {
        backlogList.appendChild(renderIssueCard(toDefaultedIssue(issue), view, onIssueUpdated, 'backlog'))
    }

    if (filteredBacklogIssues.length === 0) {
        createDiv({ cls: 'ji-sprint-list-empty', text: 'No issues in backlog', parent: backlogList })
    }

    // Footer
    const footer = createDiv({ cls: 'ji-sprint-planning-footer', parent: board })

    const lastUpdateContainer = createDiv({ parent: footer })
    createSpan({
        text: `Last update: ${ObjectsCache.getTime(view.getCacheKey())}`,
        parent: lastUpdateContainer,
    })

    const refreshButton = createEl('button', { parent: lastUpdateContainer, title: 'Refresh', cls: 'rotate-animation' })
    setIcon(refreshButton, 'sync-small')
    refreshButton.onClickEvent(refreshBoard)

    rootEl.replaceChildren(RC.renderContainer([board]))
}

/**
 * Setup drop zone for drag-and-drop
 */
function setupDropZone(
    element: HTMLElement,
    type: 'sprint' | 'backlog',
    targetId: number,
    view: SprintPlanningView,
    rootEl: HTMLElement,
    onComplete: () => void
): void {
    element.addEventListener('dragover', (e) => {
        e.preventDefault()
        element.classList.add('ji-sprint-list-dragover')
    })

    element.addEventListener('dragleave', (e) => {
        element.classList.remove('ji-sprint-list-dragover')
    })

    element.addEventListener('drop', async (e) => {
        e.preventDefault()
        element.classList.remove('ji-sprint-list-dragover')

        const issueKey = e.dataTransfer?.getData('text/plain')
        if (!issueKey) return

        // Check if dragging to the same column
        const card = rootEl.querySelector(`[data-issue-key="${issueKey}"]`) as HTMLElement
        const currentSource = card?.getAttribute('data-source')
        if (currentSource === type) {
            // Same column - do nothing
            return
        }

        try {
            const start = performance.now()
            if (type === 'sprint') {
                if (targetId > 0) {
                    console.log(`[SprintPlanning] Moving ${issueKey} to sprint ${targetId}...`)
                    await JiraClient.moveIssuesToSprint(targetId, [issueKey], { account: view.account })
                    console.log(`[SprintPlanning] moveIssuesToSprint: ${(performance.now() - start).toFixed(0)}ms`)
                    new Notice(`${issueKey} moved to sprint`)
                }
            } else {
                console.log(`[SprintPlanning] Moving ${issueKey} to backlog...`)
                await JiraClient.moveIssuesToBacklog([issueKey], { account: view.account })
                console.log(`[SprintPlanning] moveIssuesToBacklog: ${(performance.now() - start).toFixed(0)}ms`)
                new Notice(`${issueKey} moved to backlog`)
            }
            onComplete()
        } catch (error) {
            console.error('[SprintPlanning] Failed to move issue:', error)
            new Notice(`Failed to move ${issueKey}: ${error.message || error}`)
        }
    })
}

// Minimal fields needed for sprint planning cards
const SPRINT_PLANNING_FIELDS = [
    'key', 'summary', 'issuetype', 'assignee', 'priority', 'status'
]

/**
 * Load sprint planning data
 */
async function loadSprintPlanningData(view: SprintPlanningView): Promise<ISprintPlanningData> {
    const logPrefix = '[SprintPlanning]'
    const totalStart = performance.now()

    // Build fields list including estimation field
    const fields = view.estimationField
        ? [...SPRINT_PLANNING_FIELDS, view.estimationField]
        : SPRINT_PLANNING_FIELDS

    console.log(`${logPrefix} Loading data for board ${view.boardId}...`)

    // Get future sprints for the board
    const sprintsStart = performance.now()
    const sprints = await JiraClient.getSprints(view.boardId, {
        state: [ESprintState.FUTURE],
        limit: 1,
        account: view.account
    })
    console.log(`${logPrefix} getSprints: ${(performance.now() - sprintsStart).toFixed(0)}ms (found ${sprints.length} future sprints)`)

    const sprint = sprints.length > 0 ? sprints[0] : null

    // Load sprint issues and backlog in PARALLEL
    const parallelStart = performance.now()
    console.log(`${logPrefix} Loading sprint issues and backlog in parallel...`)

    const [sprintResults, backlogResults] = await Promise.all([
        (async () => {
            if (!sprint) return { issues: [], account: view.account } as IJiraSearchResults
            const start = performance.now()
            const result = await JiraClient.getSprintIssues(sprint.id, {
                limit: 200,
                fields: fields,
                account: view.account
            })
            console.log(`${logPrefix}   getSprintIssues(${sprint.id}): ${(performance.now() - start).toFixed(0)}ms (${result.issues.length} issues)`)
            return result
        })(),
        (async () => {
            const start = performance.now()
            const result = await JiraClient.getBoardBacklog(view.boardId, {
                limit: 200,
                fields: fields,
                account: view.account
            })
            console.log(`${logPrefix}   getBoardBacklog(${view.boardId}): ${(performance.now() - start).toFixed(0)}ms (${result.issues.length} issues)`)
            return result
        })()
    ])

    console.log(`${logPrefix} Parallel requests completed: ${(performance.now() - parallelStart).toFixed(0)}ms`)

    // Set account from results
    if (sprintResults.account) {
        view.account = sprintResults.account
    } else if (backlogResults.account) {
        view.account = backlogResults.account
    }

    console.log(`${logPrefix} Total load time: ${(performance.now() - totalStart).toFixed(0)}ms`)

    return {
        sprint,
        sprintIssues: sprintResults.issues,
        backlogIssues: backlogResults.issues
    }
}

/**
 * Deduplicated wrapper for loadSprintPlanningData
 * Returns existing promise if loading is already in progress for the same cache key
 */
async function loadSprintPlanningDataDeduped(view: SprintPlanningView): Promise<ISprintPlanningData> {
    const cacheKey = view.getCacheKey()

    // If already loading - return existing promise
    const existing = loadingPromises.get(cacheKey)
    if (existing) {
        console.log(`[SprintPlanning] Reusing in-flight request for ${cacheKey}`)
        return existing
    }

    // Start new loading
    const promise = loadSprintPlanningData(view)
    loadingPromises.set(cacheKey, promise)

    try {
        return await promise
    } finally {
        loadingPromises.delete(cacheKey)
    }
}

export const SprintPlanningFenceRenderer = async (
    source: string,
    rootEl: HTMLElement,
    ctx: MarkdownPostProcessorContext
): Promise<void> => {
    try {
        const view = SprintPlanningView.fromString(source)

        const cachedData = ObjectsCache.get(view.getCacheKey())
        if (cachedData) {
            if (cachedData.isError) {
                RC.renderSearchError(rootEl, cachedData.data as string, null)
            } else {
                renderSprintPlanningBoard(rootEl, view, cachedData.data as ISprintPlanningData)
            }
        } else {
            // Show loading state
            const loadingEl = createDiv({ cls: 'ji-sprint-planning-loading' })
            createSpan({ cls: 'spinner', parent: loadingEl })
            createSpan({ text: 'Loading sprint data...', parent: loadingEl })
            rootEl.appendChild(loadingEl)

            try {
                const data = await loadSprintPlanningDataDeduped(view)
                const cached = ObjectsCache.add(view.getCacheKey(), data)
                renderSprintPlanningBoard(rootEl, view, cached.data as ISprintPlanningData)
            } catch (err) {
                ObjectsCache.add(view.getCacheKey(), err, true)
                RC.renderSearchError(rootEl, err.message || err, null)
            }
        }
    } catch (err) {
        RC.renderSearchError(rootEl, err.message || err, null)
    }
}

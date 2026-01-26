import { Modal, Notice, Setting } from "obsidian"
import { IJiraSprint } from "../interfaces/issueInterfaces"
import { IJiraIssueAccountSettings } from "../interfaces/settingsInterfaces"
import { ObsidianApp } from "../main"
import JiraClient from "../client/jiraClient"

export class StartSprintModal extends Modal {
    private _sprint: IJiraSprint
    private _account: IJiraIssueAccountSettings
    private _onSuccess: () => void

    private _startDate: string
    private _endDate: string
    private _goal: string

    constructor(
        sprint: IJiraSprint,
        account: IJiraIssueAccountSettings,
        onSuccess: () => void
    ) {
        super(ObsidianApp)
        this._sprint = sprint
        this._account = account
        this._onSuccess = onSuccess

        // Default dates: today + 2 weeks
        const now = new Date()
        const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

        this._startDate = this.formatDate(now)
        this._endDate = this.formatDate(twoWeeksLater)
        this._goal = sprint.goal || ''
    }

    private formatDate(date: Date): string {
        return date.toISOString().split('T')[0]
    }

    onOpen() {
        const { contentEl } = this
        contentEl.empty()
        contentEl.addClass('jira-start-sprint-modal')

        contentEl.createEl('h2', { text: `Start Sprint: ${this._sprint.name}` })

        // Start Date
        new Setting(contentEl)
            .setName('Start Date')
            .setDesc('When the sprint should begin')
            .addText(text => {
                text.inputEl.type = 'date'
                text.setValue(this._startDate)
                text.onChange(value => {
                    this._startDate = value
                })
            })

        // End Date
        new Setting(contentEl)
            .setName('End Date')
            .setDesc('When the sprint should end')
            .addText(text => {
                text.inputEl.type = 'date'
                text.setValue(this._endDate)
                text.onChange(value => {
                    this._endDate = value
                })
            })

        // Sprint Goal
        new Setting(contentEl)
            .setName('Sprint Goal')
            .setDesc('Optional goal or theme for this sprint')
            .addTextArea(textArea => {
                textArea.setValue(this._goal)
                textArea.setPlaceholder('Enter sprint goal...')
                textArea.onChange(value => {
                    this._goal = value
                })
                textArea.inputEl.rows = 3
                textArea.inputEl.style.width = '100%'
            })

        // Warning message
        const warningEl = contentEl.createDiv({ cls: 'jira-start-sprint-warning' })
        warningEl.createSpan({
            text: 'Starting a sprint will make it active. Issues in this sprint will appear in the active sprint board.',
            cls: 'jira-start-sprint-warning-text'
        })

        // Buttons
        const buttonsEl = contentEl.createDiv({ cls: 'jira-start-sprint-buttons' })

        const cancelBtn = buttonsEl.createEl('button', {
            text: 'Cancel',
            cls: 'jira-start-sprint-btn-cancel'
        })
        cancelBtn.addEventListener('click', () => this.close())

        const startBtn = buttonsEl.createEl('button', {
            text: 'Start Sprint',
            cls: 'jira-start-sprint-btn-start'
        })
        startBtn.addEventListener('click', () => this.startSprint())
    }

    onClose() {
        this.contentEl.empty()
    }

    private async startSprint(): Promise<void> {
        // Validate dates
        if (!this._startDate || !this._endDate) {
            new Notice('Please select start and end dates')
            return
        }

        const startDate = new Date(this._startDate)
        const endDate = new Date(this._endDate)

        if (endDate <= startDate) {
            new Notice('End date must be after start date')
            return
        }

        // Show loading state
        const startBtn = this.contentEl.querySelector('.jira-start-sprint-btn-start') as HTMLButtonElement
        if (startBtn) {
            startBtn.disabled = true
            startBtn.textContent = 'Starting...'
        }

        try {
            // Format dates as ISO strings for Jira API
            const startDateISO = new Date(this._startDate + 'T09:00:00').toISOString()
            const endDateISO = new Date(this._endDate + 'T18:00:00').toISOString()

            await JiraClient.startSprint(
                this._sprint.id,
                startDateISO,
                endDateISO,
                {
                    goal: this._goal || undefined,
                    account: this._account
                }
            )

            new Notice(`Sprint "${this._sprint.name}" started successfully!`)
            this.close()
            this._onSuccess()
        } catch (error) {
            console.error('Failed to start sprint:', error)
            new Notice(`Failed to start sprint: ${error.message || error}`)

            // Reset button state
            if (startBtn) {
                startBtn.disabled = false
                startBtn.textContent = 'Start Sprint'
            }
        }
    }
}

export class CapacitySettingsModal extends Modal {
    private _capacity: Record<string, number>
    private _onSave: (capacity: Record<string, number>) => void
    private _assignees: { displayName: string, username: string }[]

    constructor(
        capacity: Record<string, number>,
        assignees: { displayName: string, username: string }[],
        onSave: (capacity: Record<string, number>) => void
    ) {
        super(ObsidianApp)
        this._capacity = { ...capacity }
        this._assignees = assignees
        this._onSave = onSave
    }

    onOpen() {
        const { contentEl } = this
        contentEl.empty()
        contentEl.addClass('jira-capacity-modal')

        contentEl.createEl('h2', { text: 'Team Capacity Settings' })

        const description = contentEl.createDiv({ cls: 'jira-capacity-description' })
        description.setText('Set capacity for each team member (in estimation units)')

        // Create capacity inputs for each assignee
        const capacityList = contentEl.createDiv({ cls: 'jira-capacity-list' })

        for (const assignee of this._assignees) {
            const key = assignee.displayName
            const currentCapacity = this._capacity[key] ?? 0

            new Setting(capacityList)
                .setName(assignee.displayName)
                .addText(text => {
                    text.inputEl.type = 'number'
                    text.inputEl.min = '0'
                    text.inputEl.step = 'any'
                    text.setValue(currentCapacity.toString())
                    text.onChange(value => {
                        const numValue = parseFloat(value)
                        if (!isNaN(numValue) && numValue >= 0) {
                            this._capacity[key] = numValue
                        } else {
                            delete this._capacity[key]
                        }
                    })
                })
        }

        // Add new member section
        contentEl.createEl('h4', { text: 'Add Team Member' })
        let newMemberName = ''
        let newMemberCapacity = 0

        const addMemberSetting = new Setting(contentEl)
            .addText(text => {
                text.setPlaceholder('Name')
                text.onChange(value => {
                    newMemberName = value
                })
            })
            .addText(text => {
                text.inputEl.type = 'number'
                text.inputEl.min = '0'
                text.inputEl.placeholder = 'Capacity'
                text.onChange(value => {
                    newMemberCapacity = parseFloat(value) || 0
                })
            })
            .addButton(btn => {
                btn.setButtonText('Add')
                btn.onClick(() => {
                    if (newMemberName && newMemberCapacity > 0) {
                        this._capacity[newMemberName] = newMemberCapacity
                        this.onOpen() // Refresh the modal
                    }
                })
            })

        // Buttons
        const buttonsEl = contentEl.createDiv({ cls: 'jira-capacity-buttons' })

        const cancelBtn = buttonsEl.createEl('button', {
            text: 'Cancel',
            cls: 'jira-capacity-btn-cancel'
        })
        cancelBtn.addEventListener('click', () => this.close())

        const saveBtn = buttonsEl.createEl('button', {
            text: 'Save',
            cls: 'jira-capacity-btn-save'
        })
        saveBtn.addEventListener('click', () => {
            this._onSave(this._capacity)
            this.close()
        })
    }

    onClose() {
        this.contentEl.empty()
    }
}

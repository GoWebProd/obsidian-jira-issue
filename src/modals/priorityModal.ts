import { Modal, Notice, Setting } from "obsidian"
import { IJiraIssue, IJiraPriority } from "../interfaces/issueInterfaces"
import { ObsidianApp } from "../main"
import JiraClient from "../client/jiraClient"
import ObjectsCache from "../objectsCache"

export class PriorityModal extends Modal {
    private _issue: IJiraIssue
    private _priorities: IJiraPriority[]
    private _selectedPriorityId: string | null
    private _onComplete: (updatedIssue: IJiraIssue) => void
    private _isLoading: boolean

    constructor(
        issue: IJiraIssue,
        onComplete: (updatedIssue: IJiraIssue) => void
    ) {
        super(ObsidianApp)
        this._issue = issue
        this._onComplete = onComplete
        this._priorities = []
        this._selectedPriorityId = null
        this._isLoading = true
    }

    async onOpen() {
        const { contentEl } = this
        contentEl.empty()
        contentEl.addClass('jira-priority-modal')

        contentEl.createEl('h2', { text: `Change Priority: ${this._issue.key}` })

        const loadingEl = contentEl.createEl('p', { text: 'Loading priorities...' })

        try {
            this._priorities = await JiraClient.getIssuePriorities(this._issue.key, {
                account: this._issue.account
            })
            this._isLoading = false
            loadingEl.remove()
            this.renderPriorities()
        } catch (error) {
            console.error('Failed to load priorities:', error)
            loadingEl.setText(`Failed to load priorities: ${error.message}`)

            new Setting(contentEl)
                .addButton(btn => btn
                    .setButtonText('Close')
                    .onClick(() => this.close()))
        }
    }

    private renderPriorities(): void {
        const { contentEl } = this

        if (this._priorities.length === 0) {
            contentEl.createEl('p', { text: 'No priorities available.', cls: 'jira-priority-modal-empty' })

            new Setting(contentEl)
                .addButton(btn => btn
                    .setButtonText('Close')
                    .onClick(() => this.close()))
            return
        }

        const currentPriorityName = this._issue.fields.priority?.name

        const prioritiesContainer = contentEl.createDiv({ cls: 'jira-priority-list' })

        for (const priority of this._priorities) {
            const isCurrent = priority.name === currentPriorityName
            const priorityItem = prioritiesContainer.createDiv({
                cls: `jira-priority-item${isCurrent ? ' is-current' : ''}`
            })

            if (priority.iconUrl) {
                priorityItem.createEl('img', {
                    cls: 'jira-priority-icon',
                    attr: { src: priority.iconUrl, alt: priority.name }
                })
            }

            const labelEl = priorityItem.createEl('label', {
                cls: 'jira-priority-label'
            })

            const radio = labelEl.createEl('input', {
                type: 'radio',
                attr: {
                    name: 'priority',
                    value: priority.id
                }
            }) as HTMLInputElement

            if (isCurrent) {
                radio.checked = true
                this._selectedPriorityId = priority.id
            }

            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this._selectedPriorityId = priority.id
                }
            })

            labelEl.createSpan({ text: priority.name })

            if (isCurrent) {
                labelEl.createSpan({ text: ' (current)', cls: 'jira-priority-current-tag' })
            }
        }

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText('Change Priority')
                .setCta()
                .onClick(async () => {
                    await this.applyPriority()
                }))
    }

    private async applyPriority(): Promise<void> {
        if (!this._selectedPriorityId) {
            new Notice('No priority selected')
            return
        }

        const selectedPriority = this._priorities.find(p => p.id === this._selectedPriorityId)
        if (!selectedPriority) {
            new Notice('Selected priority not found')
            return
        }

        if (selectedPriority.name === this._issue.fields.priority?.name) {
            new Notice('Priority unchanged')
            this.close()
            return
        }

        try {
            await JiraClient.updateIssuePriority(this._issue.key, this._selectedPriorityId, {
                account: this._issue.account
            })

            this._issue.fields.priority = {
                name: selectedPriority.name,
                iconUrl: selectedPriority.iconUrl
            }

            ObjectsCache.add(this._issue.key, this._issue, false)

            this._onComplete(this._issue)

            new Notice(`Priority changed to ${selectedPriority.name}`)
            this.close()
        } catch (error) {
            console.error('Failed to update priority:', error)
            new Notice(`Failed to update priority: ${error.message}`)
        }
    }

    onClose() {
        this.contentEl.empty()
    }
}

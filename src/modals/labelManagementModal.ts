import { Modal, Notice, Setting } from "obsidian"
import { IJiraIssue } from "../interfaces/issueInterfaces"
import { ObsidianApp } from "../main"
import JiraClient from "../client/jiraClient"
import ObjectsCache from "../objectsCache"

export type LabelAction = 'add' | 'remove'

export class LabelManagementModal extends Modal {
    private _issue: IJiraIssue
    private _action: LabelAction
    private _availableLabels: string[]
    private _selectedLabels: Set<string>
    private _onComplete: (updatedIssue: IJiraIssue) => void

    constructor(
        issue: IJiraIssue,
        action: LabelAction,
        onComplete: (updatedIssue: IJiraIssue) => void
    ) {
        super(ObsidianApp)
        this._issue = issue
        this._action = action
        this._onComplete = onComplete
        this._selectedLabels = new Set()

        if (action === 'add') {
            this._availableLabels = issue.account?.predefinedLabels || []
        } else {
            this._availableLabels = issue.fields.labels || []
        }
    }

    onOpen() {
        const { contentEl } = this
        contentEl.empty()
        contentEl.addClass('jira-label-modal')

        const title = this._action === 'add' ? 'Add Labels' : 'Remove Labels'
        contentEl.createEl('h2', { text: `${title}: ${this._issue.key}` })

        if (this._availableLabels.length === 0) {
            const msg = this._action === 'add'
                ? 'No predefined labels configured for this account. Add labels in plugin settings.'
                : 'This issue has no labels.'
            contentEl.createEl('p', { text: msg, cls: 'jira-label-modal-empty' })

            new Setting(contentEl)
                .addButton(btn => btn
                    .setButtonText('Close')
                    .onClick(() => this.close()))
            return
        }

        const labelsContainer = contentEl.createDiv({ cls: 'jira-label-checkboxes' })

        for (const label of this._availableLabels) {
            const isAlreadySet = this._action === 'add' && this._issue.fields.labels?.includes(label)

            new Setting(labelsContainer)
                .setName(label)
                .setDesc(isAlreadySet ? '(already set)' : '')
                .addToggle(toggle => toggle
                    .setValue(false)
                    .setDisabled(isAlreadySet)
                    .onChange(value => {
                        if (value) {
                            this._selectedLabels.add(label)
                        } else {
                            this._selectedLabels.delete(label)
                        }
                    }))
        }

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText(this._action === 'add' ? 'Add Selected' : 'Remove Selected')
                .setCta()
                .onClick(async () => {
                    await this.applyLabels()
                }))
    }

    private async applyLabels(): Promise<void> {
        if (this._selectedLabels.size === 0) {
            new Notice('No labels selected')
            return
        }

        try {
            const currentLabels = [...(this._issue.fields.labels || [])]
            let newLabels: string[]

            if (this._action === 'add') {
                newLabels = [...new Set([...currentLabels, ...this._selectedLabels])]
            } else {
                newLabels = currentLabels.filter(l => !this._selectedLabels.has(l))
            }

            await JiraClient.updateIssueLabels(this._issue.key, newLabels, {
                account: this._issue.account
            })

            this._issue.fields.labels = newLabels

            ObjectsCache.add(this._issue.key, this._issue, false)

            this._onComplete(this._issue)

            const action = this._action === 'add' ? 'added' : 'removed'
            new Notice(`Labels ${action} successfully`)
            this.close()
        } catch (error) {
            console.error('Failed to update labels:', error)
            new Notice(`Failed to update labels: ${error.message}`)
        }
    }

    onClose() {
        this.contentEl.empty()
    }
}

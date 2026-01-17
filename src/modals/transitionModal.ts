import { Modal, Notice, Setting } from "obsidian"
import { IJiraIssue, IJiraTransition, IJiraTransitionField } from "../interfaces/issueInterfaces"
import { ObsidianApp } from "../main"
import JiraClient from "../client/jiraClient"
import ObjectsCache from "../objectsCache"

export class TransitionModal extends Modal {
    private _issue: IJiraIssue
    private _transitions: IJiraTransition[]
    private _selectedTransitionId: string | null
    private _onComplete: (updatedIssue: IJiraIssue) => void
    private _isLoading: boolean
    private _fieldValues: Record<string, any>
    private _fieldsContainer: HTMLElement | null

    constructor(
        issue: IJiraIssue,
        onComplete: (updatedIssue: IJiraIssue) => void
    ) {
        super(ObsidianApp)
        this._issue = issue
        this._onComplete = onComplete
        this._transitions = []
        this._selectedTransitionId = null
        this._isLoading = true
        this._fieldValues = {}
        this._fieldsContainer = null
    }

    async onOpen() {
        const { contentEl } = this
        contentEl.empty()
        contentEl.addClass('jira-transition-modal')

        contentEl.createEl('h2', { text: `Change Status: ${this._issue.key}` })

        // Show current status
        const currentStatus = this._issue.fields.status?.name || 'Unknown'
        contentEl.createEl('p', {
            text: `Current status: ${currentStatus}`,
            cls: 'jira-transition-current-status'
        })

        const loadingEl = contentEl.createEl('p', { text: 'Loading transitions...' })

        try {
            this._transitions = await JiraClient.getIssueTransitions(this._issue.key, {
                account: this._issue.account
            })
            this._isLoading = false
            loadingEl.remove()
            this.renderTransitions()
        } catch (error) {
            loadingEl.setText(`Failed to load transitions: ${error.message}`)

            new Setting(contentEl)
                .addButton(btn => btn
                    .setButtonText('Close')
                    .onClick(() => this.close()))
        }
    }

    private renderTransitions(): void {
        const { contentEl } = this

        if (this._transitions.length === 0) {
            contentEl.createEl('p', {
                text: 'No transitions available from current status.',
                cls: 'jira-transition-modal-empty'
            })

            new Setting(contentEl)
                .addButton(btn => btn
                    .setButtonText('Close')
                    .onClick(() => this.close()))
            return
        }

        const transitionsContainer = contentEl.createDiv({ cls: 'jira-transition-list' })

        for (const transition of this._transitions) {
            const transitionItem = transitionsContainer.createDiv({
                cls: 'jira-transition-item'
            })

            const labelEl = transitionItem.createEl('label', {
                cls: 'jira-transition-label'
            })

            const radio = labelEl.createEl('input', {
                type: 'radio',
                attr: {
                    name: 'transition',
                    value: transition.id
                }
            }) as HTMLInputElement

            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this._selectedTransitionId = transition.id
                    this._fieldValues = {}
                    this.renderRequiredFields(transition)
                }
            })

            // Transition name
            labelEl.createSpan({ text: transition.name, cls: 'jira-transition-name' })

            // Target status indicator
            if (transition.to) {
                const statusBadge = labelEl.createSpan({
                    cls: 'jira-transition-target-status'
                })
                statusBadge.createSpan({ text: ' → ' })
                const statusName = statusBadge.createSpan({
                    text: transition.to.name,
                    cls: 'jira-status-badge'
                })
                // Apply color class based on status category
                if (transition.to.statusCategory?.colorName) {
                    statusName.addClass(`jira-status-${transition.to.statusCategory.colorName.toLowerCase()}`)
                }
            }
        }

        // Container for required fields (rendered when transition is selected)
        this._fieldsContainer = contentEl.createDiv({ cls: 'jira-transition-fields' })

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText('Change Status')
                .setCta()
                .onClick(async () => {
                    await this.applyTransition()
                }))
    }

    private renderRequiredFields(transition: IJiraTransition): void {
        if (!this._fieldsContainer) return

        this._fieldsContainer.empty()

        // Check if transition has required fields
        if (!transition.fields) return

        const requiredFields = Object.entries(transition.fields).filter(
            ([_, field]) => field.required && !field.hasDefaultValue
        )

        if (requiredFields.length === 0) return

        this._fieldsContainer.createEl('div', {
            text: 'Required Fields',
            cls: 'jira-transition-fields-header'
        })

        for (const [fieldKey, field] of requiredFields) {
            this.renderField(fieldKey, field)
        }
    }

    private renderField(fieldKey: string, field: IJiraTransitionField): void {
        if (!this._fieldsContainer) return

        const fieldContainer = this._fieldsContainer.createDiv({
            cls: 'jira-transition-field'
        })

        // Determine if this is a dropdown (has allowedValues) or text input
        if (field.allowedValues && field.allowedValues.length > 0) {
            this.renderDropdownField(fieldContainer, fieldKey, field)
        } else {
            this.renderTextField(fieldContainer, fieldKey, field)
        }
    }

    private renderDropdownField(
        container: HTMLElement,
        fieldKey: string,
        field: IJiraTransitionField
    ): void {
        const setting = new Setting(container)
            .setName(field.name)
            .setDesc(`Select a ${field.name.toLowerCase()}`)

        setting.addDropdown(dropdown => {
            // Add empty option first
            dropdown.addOption('', `Select ${field.name}...`)

            // Add allowed values
            for (const value of field.allowedValues || []) {
                // Handle different value formats (some have id/name, others are strings)
                const optionValue = value.id || value.name || String(value)
                const optionLabel = value.name || value.value || String(value)
                dropdown.addOption(optionValue, optionLabel)
            }

            dropdown.onChange(value => {
                if (value) {
                    // Store the value in the format Jira expects
                    // For resolution and similar fields, we need { name: "..." } or { id: "..." }
                    const selectedValue = field.allowedValues?.find(
                        v => (v.id || v.name || String(v)) === value
                    )
                    if (selectedValue) {
                        // Use the original format from allowedValues
                        if (selectedValue.id) {
                            this._fieldValues[fieldKey] = { id: selectedValue.id }
                        } else if (selectedValue.name) {
                            this._fieldValues[fieldKey] = { name: selectedValue.name }
                        } else {
                            this._fieldValues[fieldKey] = value
                        }
                    } else {
                        this._fieldValues[fieldKey] = value
                    }
                } else {
                    delete this._fieldValues[fieldKey]
                }
            })
        })
    }

    private renderTextField(
        container: HTMLElement,
        fieldKey: string,
        field: IJiraTransitionField
    ): void {
        const setting = new Setting(container)
            .setName(field.name)
            .setDesc(`Enter ${field.name.toLowerCase()}`)

        setting.addText(text => {
            text.setPlaceholder(`Enter ${field.name.toLowerCase()}...`)

            text.onChange(value => {
                if (value.trim()) {
                    this._fieldValues[fieldKey] = value.trim()
                } else {
                    delete this._fieldValues[fieldKey]
                }
            })
        })
    }

    private validateRequiredFields(transition: IJiraTransition): string[] {
        const missingFields: string[] = []

        if (!transition.fields) return missingFields

        for (const [fieldKey, field] of Object.entries(transition.fields)) {
            if (field.required && !field.hasDefaultValue) {
                if (!(fieldKey in this._fieldValues) || this._fieldValues[fieldKey] === '') {
                    missingFields.push(field.name)
                }
            }
        }

        return missingFields
    }

    private async applyTransition(): Promise<void> {
        if (!this._selectedTransitionId) {
            new Notice('No transition selected')
            return
        }

        const selectedTransition = this._transitions.find(t => t.id === this._selectedTransitionId)
        if (!selectedTransition) {
            new Notice('Selected transition not found')
            return
        }

        // Validate required fields
        const missingFields = this.validateRequiredFields(selectedTransition)
        if (missingFields.length > 0) {
            new Notice(`Please fill required fields: ${missingFields.join(', ')}`)
            return
        }

        try {
            // Pass field values if any were collected
            const fields = Object.keys(this._fieldValues).length > 0 ? this._fieldValues : undefined
            await JiraClient.transitionIssue(this._issue.key, this._selectedTransitionId, fields, {
                account: this._issue.account
            })

            // Update local issue object with new status
            this._issue.fields.status = {
                name: selectedTransition.to.name,
                description: '',
                statusCategory: selectedTransition.to.statusCategory || {
                    colorName: ''
                }
            }

            // Update resolution if it was set during transition
            if (this._fieldValues.resolution) {
                const resolutionValue = this._fieldValues.resolution
                this._issue.fields.resolution = {
                    name: resolutionValue.name || resolutionValue.id || resolutionValue,
                    description: ''
                }
            }

            ObjectsCache.add(this._issue.key, this._issue, false)

            this._onComplete(this._issue)

            new Notice(`Status changed to ${selectedTransition.to.name}`)
            this.close()
        } catch (error) {
            new Notice(`Failed to change status: ${error.message}`)
        }
    }

    onClose() {
        this.contentEl.empty()
    }
}

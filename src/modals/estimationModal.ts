import { Modal, Notice, Setting } from "obsidian"
import { IJiraIssue } from "../interfaces/issueInterfaces"
import { ObsidianApp } from "../main"
import JiraClient from "../client/jiraClient"
import ObjectsCache from "../objectsCache"

// Common estimation field names
const STORY_POINTS_FIELDS = [
    'customfield_10016',  // Common Jira Cloud Story Points
    'customfield_10002',  // Alternative Story Points
    'customfield_10004',  // Another alternative
]

// Fibonacci sequence for story points
const FIBONACCI_VALUES = [1, 2, 3, 5, 8, 13, 21]

interface EstimationFieldInfo {
    fieldId: string
    fieldName: string
    type: 'story_points' | 'time' | 'number'
    currentValue: number | null
}

export class EstimationModal extends Modal {
    private _issue: IJiraIssue
    private _onComplete: (updatedIssue: IJiraIssue) => void
    private _preferredField: string | null
    private _fieldInfo: EstimationFieldInfo | null = null
    private _selectedValue: number | null = null
    private _customInputEl: HTMLInputElement | null = null

    constructor(
        issue: IJiraIssue,
        onComplete: (updatedIssue: IJiraIssue) => void,
        preferredField?: string
    ) {
        super(ObsidianApp)
        this._issue = issue
        this._onComplete = onComplete
        this._preferredField = preferredField || null
    }

    async onOpen() {
        const { contentEl } = this
        contentEl.empty()
        contentEl.addClass('jira-estimation-modal')

        contentEl.createEl('h2', { text: `Change Estimation: ${this._issue.key}` })

        // Detect estimation field
        this._fieldInfo = this.detectEstimationField()

        if (!this._fieldInfo) {
            this.renderNoFieldWarning()
            return
        }

        this._selectedValue = this._fieldInfo.currentValue

        this.renderEstimationInput()
    }

    /**
     * Detect which estimation field is available for this issue
     */
    private detectEstimationField(): EstimationFieldInfo | null {
        const fields = this._issue.fields as Record<string, unknown>
        const account = this._issue.account

        // 0. If preferred field is specified, use it
        if (this._preferredField) {
            return this.getFieldInfo(this._preferredField, fields)
        }

        // 1. Check Story Points (common custom field names)
        for (const fieldId of STORY_POINTS_FIELDS) {
            if (fieldId in fields && fields[fieldId] !== undefined) {
                return {
                    fieldId,
                    fieldName: 'Story Points',
                    type: 'story_points',
                    currentValue: fields[fieldId] !== null ? Number(fields[fieldId]) : null
                }
            }
        }

        // 2. Check account cache for Story Points field
        if (account?.cache?.customFieldsNameToId) {
            const storyPointsId = account.cache.customFieldsNameToId['Story Points']
            if (storyPointsId) {
                const fieldId = `customfield_${storyPointsId}`
                return {
                    fieldId,
                    fieldName: 'Story Points',
                    type: 'story_points',
                    currentValue: fields[fieldId] !== null && fields[fieldId] !== undefined
                        ? Number(fields[fieldId])
                        : null
                }
            }
        }

        // 3. Check timeoriginalestimate (in seconds)
        if ('timeoriginalestimate' in fields) {
            const seconds = fields.timeoriginalestimate as number | null
            return {
                fieldId: 'timeoriginalestimate',
                fieldName: 'Original Estimate',
                type: 'time',
                currentValue: seconds ? Math.round(seconds / 3600) : null // Convert to hours
            }
        }

        // 4. Try common story points fields even if not in fields (for new issues)
        // Prioritize the most common one
        return {
            fieldId: 'customfield_10016',
            fieldName: 'Story Points',
            type: 'story_points',
            currentValue: null
        }
    }

    /**
     * Get field info for a specific field ID
     */
    private getFieldInfo(fieldId: string, fields: Record<string, unknown>): EstimationFieldInfo {
        // Time-based fields
        if (fieldId === 'timeoriginalestimate' || fieldId === 'timeestimate') {
            const seconds = fields[fieldId] as number | null
            return {
                fieldId,
                fieldName: fieldId === 'timeoriginalestimate' ? 'Original Estimate' : 'Remaining Estimate',
                type: 'time',
                currentValue: seconds ? Math.round(seconds / 3600) : null
            }
        }

        // Story points or other numeric fields
        const fieldName = this.getFieldName(fieldId)
        return {
            fieldId,
            fieldName,
            type: 'story_points',
            currentValue: fields[fieldId] !== null && fields[fieldId] !== undefined
                ? Number(fields[fieldId])
                : null
        }
    }

    /**
     * Get human-readable field name
     */
    private getFieldName(fieldId: string): string {
        const account = this._issue.account
        if (account?.cache?.customFieldsIdToName) {
            // Extract numeric ID from customfield_XXXXX
            const match = fieldId.match(/customfield_(\d+)/)
            if (match) {
                const name = account.cache.customFieldsIdToName[match[1]]
                if (name) return name
            }
        }
        // Fallback names
        if (fieldId.startsWith('customfield_')) {
            return 'Story Points'
        }
        return fieldId
    }

    private renderNoFieldWarning(): void {
        const { contentEl } = this

        const warningEl = contentEl.createDiv({ cls: 'jira-estimation-warning' })
        warningEl.createEl('p', {
            text: 'Could not detect an estimation field for this issue.'
        })
        warningEl.createEl('p', {
            text: 'Make sure Story Points or Time Estimate field is configured in your Jira project.',
            cls: 'jira-estimation-warning-hint'
        })

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Close')
                .onClick(() => this.close()))
    }

    private renderEstimationInput(): void {
        const { contentEl } = this
        const fieldInfo = this._fieldInfo!

        // Current value display
        const currentValueText = fieldInfo.currentValue !== null
            ? this.formatValue(fieldInfo.currentValue)
            : 'Not set'

        contentEl.createEl('p', {
            text: `${fieldInfo.fieldName}: ${currentValueText}`,
            cls: 'jira-estimation-current'
        })

        if (fieldInfo.type === 'story_points') {
            this.renderStoryPointsInput()
        } else {
            this.renderNumericInput()
        }

        // Buttons
        const buttonsContainer = contentEl.createDiv({ cls: 'jira-estimation-buttons-row' })

        const cancelBtn = buttonsContainer.createEl('button', {
            text: 'Cancel',
            cls: 'jira-estimation-btn-cancel'
        })
        cancelBtn.addEventListener('click', () => this.close())

        const clearBtn = buttonsContainer.createEl('button', {
            text: 'Clear',
            cls: 'jira-estimation-btn-clear'
        })
        clearBtn.addEventListener('click', async () => {
            this._selectedValue = null
            await this.applyEstimation()
        })

        const saveBtn = buttonsContainer.createEl('button', {
            text: 'Save',
            cls: 'jira-estimation-btn-save'
        })
        saveBtn.addEventListener('click', async () => {
            await this.applyEstimation()
        })
    }

    private renderStoryPointsInput(): void {
        const { contentEl } = this

        // Fibonacci buttons
        const buttonsContainer = contentEl.createDiv({ cls: 'jira-estimation-buttons' })

        for (const value of FIBONACCI_VALUES) {
            const btn = buttonsContainer.createEl('button', {
                text: String(value),
                cls: `jira-estimation-btn${this._selectedValue === value ? ' is-selected' : ''}`
            })
            btn.addEventListener('click', () => {
                this.selectValue(value)
            })
        }

        // Custom input
        const customContainer = contentEl.createDiv({ cls: 'jira-estimation-custom' })
        customContainer.createSpan({ text: 'Custom: ' })

        this._customInputEl = customContainer.createEl('input', {
            type: 'number',
            cls: 'jira-estimation-custom-input',
            attr: {
                min: '0',
                step: '0.5',
                placeholder: 'Enter value'
            }
        })

        if (this._selectedValue !== null && !FIBONACCI_VALUES.includes(this._selectedValue)) {
            this._customInputEl.value = String(this._selectedValue)
        }

        this._customInputEl.addEventListener('input', () => {
            const value = parseFloat(this._customInputEl!.value)
            if (!isNaN(value) && value >= 0) {
                this._selectedValue = value
                // Clear button selection
                this.updateButtonSelection()
            }
        })
    }

    private renderNumericInput(): void {
        const { contentEl } = this
        const fieldInfo = this._fieldInfo!

        const inputContainer = contentEl.createDiv({ cls: 'jira-estimation-numeric' })
        inputContainer.createSpan({ text: `${fieldInfo.fieldName} (hours): ` })

        const input = inputContainer.createEl('input', {
            type: 'number',
            cls: 'jira-estimation-numeric-input',
            attr: {
                min: '0',
                step: '0.5',
                placeholder: 'Enter hours'
            }
        }) as HTMLInputElement

        if (this._selectedValue !== null) {
            input.value = String(this._selectedValue)
        }

        input.addEventListener('input', () => {
            const value = parseFloat(input.value)
            if (!isNaN(value) && value >= 0) {
                this._selectedValue = value
            } else {
                this._selectedValue = null
            }
        })
    }

    private selectValue(value: number): void {
        this._selectedValue = value
        if (this._customInputEl) {
            this._customInputEl.value = ''
        }
        this.updateButtonSelection()
    }

    private updateButtonSelection(): void {
        const buttons = this.contentEl.querySelectorAll('.jira-estimation-btn')
        buttons.forEach(btn => {
            const btnValue = parseInt(btn.textContent || '0')
            btn.classList.toggle('is-selected', btnValue === this._selectedValue)
        })
    }

    private formatValue(value: number): string {
        if (this._fieldInfo?.type === 'time') {
            return `${value}h`
        }
        return String(value)
    }

    private async applyEstimation(): Promise<void> {
        const fieldInfo = this._fieldInfo!

        try {
            // Time tracking fields require special handling via timetracking object
            if (fieldInfo.type === 'time') {
                const timeValue = this._selectedValue !== null ? `${this._selectedValue}h` : null
                await JiraClient.updateIssueTimeTracking(
                    this._issue.key,
                    fieldInfo.fieldId,
                    timeValue,
                    { account: this._issue.account }
                )
            } else {
                await JiraClient.updateIssueField(
                    this._issue.key,
                    fieldInfo.fieldId,
                    this._selectedValue,
                    { account: this._issue.account }
                )
            }

            // Update local issue object
            const fields = this._issue.fields as Record<string, unknown>
            if (fieldInfo.type === 'time') {
                // Store as seconds for consistency with Jira API response format
                fields[fieldInfo.fieldId] = this._selectedValue !== null ? this._selectedValue * 3600 : null
            } else {
                fields[fieldInfo.fieldId] = this._selectedValue
            }

            // Update cache
            ObjectsCache.add(this._issue.key, this._issue, false)

            // Notify completion
            this._onComplete(this._issue)

            const displayValue = this._selectedValue !== null
                ? this.formatValue(this._selectedValue)
                : 'cleared'
            new Notice(`Estimation ${displayValue}`)
            this.close()
        } catch (error) {
            console.error('Failed to update estimation:', error)
            new Notice(`Failed to update estimation: ${error.message}`)
        }
    }

    onClose() {
        this.contentEl.empty()
    }
}

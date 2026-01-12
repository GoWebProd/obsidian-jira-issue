import { MarkdownPostProcessorContext } from "obsidian"
import JiraClient from "../client/jiraClient"
import { IJiraIssue } from "../interfaces/issueInterfaces"
import { COMPACT_SYMBOL, JIRA_KEY_REGEX } from "../interfaces/settingsInterfaces"
import ObjectsCache from "../objectsCache"
import { SettingsData } from "../settings"
import RC from "./renderingCommon"
import { getGlobalBatchManager } from "../batching/issueBatchManager"

// TODO: support explicit account selection in inline issues

function convertInlineIssuesToTags(el: HTMLElement): void {
    if (SettingsData.inlineIssuePrefix) {
        let match
        while (match = new RegExp(`${SettingsData.inlineIssuePrefix}(${COMPACT_SYMBOL}?)(${JIRA_KEY_REGEX})`).exec(el.innerHTML)) {
            // console.log({ match })
            const compact = !!match[1]
            const issueKey = match[2]
            const container = createSpan({ cls: 'ji-inline-issue jira-issue-container', attr: { 'data-issue-key': issueKey, 'data-compact': compact } })
            container.appendChild(RC.renderLoadingItem(issueKey, true))
            el.innerHTML = el.innerHTML.replace(match[0], container.outerHTML)
        }
    }
}

function convertInlineIssuesUrlToTags(el: HTMLElement): void {
    if (SettingsData.inlineIssueUrlToTag) {
        for (const account of SettingsData.accounts) {
            const issueUrlElements = el.querySelectorAll(`a.external-link[href^="${account.host}/browse/"]`)
            issueUrlElements.forEach((issueUrlElement: HTMLAnchorElement) => {
                const compact = issueUrlElement.previousSibling && issueUrlElement.previousSibling.textContent.endsWith('-')
                const issueKey = issueUrlElement.href.replace(`${account.host}/browse/`, '')
                const container = createSpan({ cls: 'ji-inline-issue jira-issue-container', attr: { 'data-issue-key': issueKey, 'data-compact': compact } })
                container.appendChild(RC.renderLoadingItem(issueKey, true))
                issueUrlElement.replaceWith(container)
            })
        }
    }
}

export const InlineIssueRenderer = async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    // console.log({ el })
    convertInlineIssuesToTags(el)
    convertInlineIssuesUrlToTags(el)

    const batchManager = getGlobalBatchManager()
    const inlineIssueTags: NodeListOf<HTMLSpanElement> = el.querySelectorAll(`span.ji-inline-issue`)
    inlineIssueTags.forEach((value: HTMLSpanElement) => {
        const issueKey = value.getAttribute('data-issue-key')
        const compact = value.getAttribute('data-compact') === 'true'

        // Recursive callback for re-rendering after issue update
        const onIssueUpdated = (updatedIssue: IJiraIssue) => {
            value.replaceChildren(RC.renderIssue(updatedIssue, compact, onIssueUpdated))
        }

        const cachedIssue = ObjectsCache.get(issueKey)
        if (cachedIssue) {
            if (cachedIssue.isError) {
                value.replaceChildren(RC.renderIssueError(issueKey, cachedIssue.data as string))
            } else {
                value.replaceChildren(RC.renderIssue(cachedIssue.data as IJiraIssue, compact, onIssueUpdated))
            }
        } else {
            value.replaceChildren(RC.renderLoadingItem(issueKey))
            batchManager.registerIssue(issueKey, {
                compact,
                onSuccess: (issue) => {
                    value.replaceChildren(RC.renderIssue(issue, compact, onIssueUpdated))
                },
                onError: (err) => {
                    value.replaceChildren(RC.renderIssueError(issueKey, err))
                }
            })
        }
    })
}
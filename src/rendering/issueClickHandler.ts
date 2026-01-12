import { IJiraIssue } from "../interfaces/issueInterfaces"
import { IssueDetailModal } from "../modals/issueDetailModal"

/**
 * Attaches a click handler to an issue link element.
 * - Regular click opens the detail modal
 * - Ctrl/Cmd+click allows native browser navigation to Jira
 */
export function attachIssueClickHandler(
    element: HTMLAnchorElement,
    issue: IJiraIssue
): void {
    element.addEventListener('click', (event: MouseEvent) => {
        // Allow modifier+click for native browser navigation
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) {
            return
        }

        event.preventDefault()
        event.stopPropagation()

        new IssueDetailModal(issue).open()
    })
}

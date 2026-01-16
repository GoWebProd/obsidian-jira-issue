---
sidebar_position: 6
---

# jira-changelog

Displays recent changes from Jira issues in a table format with optional grouping by issue, author, or both. Useful for tracking team activity, monitoring issue updates, and reviewing recent work.

## Basic Usage

The simplest changelog requires only a JQL query:

````markdown
```jira-changelog
query: project = DEMO AND updated >= -1d
```
````

This shows all field changes from issues matching the query.

### Single-Line Syntax

For quick queries, you can use a single line without the `query:` prefix:

````markdown
```jira-changelog
assignee = currentUser() AND updated >= -1d
```
````

## Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *required* | JQL query to fetch issues with changelog |
| `account` | string | first account | Account alias for multi-account setups |
| `limit` | number | `20` | Maximum number of issues to fetch |
| `period` | string | unlimited | Filter changes to specific time period (see Period Format) |
| `fields` | string | all fields | Comma-separated list of fields to include (case-insensitive) |
| `excludeFields` | string | none | Comma-separated list of fields to exclude (case-insensitive) |
| `groupBy` | string | `null` | Group changes: `issue`, `author`, or `author+issue` |

### Period Format

The `period` parameter filters changes to a specific time window. Supported formats:

| Format | Example | Description |
|--------|---------|-------------|
| `Nm` | `30m` | Last N minutes |
| `Nh` | `2h` | Last N hours |
| `Nd` | `1d` | Last N days |
| `Nw` | `1w` | Last N weeks |

Example:
````markdown
```jira-changelog
query: project = DEMO
period: 2h
```
````

Shows only changes from the last 2 hours.

## Field Filtering

You can filter which field changes are displayed using `fields` (include only) or `excludeFields` (exclude).

**Note:** You cannot use both `fields` and `excludeFields` in the same block.

### Include Only Specific Fields

````markdown
```jira-changelog
query: project = DEMO AND updated >= -1d
fields: status, assignee, priority
```
````

Shows only Status, Assignee, and Priority changes.

### Exclude Fields

````markdown
```jira-changelog
query: project = DEMO AND updated >= -1d
excludeFields: description, comment
```
````

Shows all changes except Description and Comment.

### Common Field Names

- `status` - Status transitions
- `assignee` - Assignee changes
- `priority` - Priority changes
- `labels` - Label additions/removals
- `comment` - Comments added/edited/deleted
- `attachment` - Attachments added/removed
- `description` - Description edits
- `summary` - Summary (title) changes
- `fix version` - Fix Version changes
- `sprint` - Sprint changes

## Grouping

The `groupBy` parameter organizes changes into collapsible swimlanes.

### Group by Issue

````markdown
```jira-changelog
query: project = DEMO AND sprint in openSprints()
groupBy: issue
```
````

Creates a swimlane for each issue showing:
- Issue type icon
- Issue key (clickable)
- Issue summary
- Change count

### Group by Author

````markdown
```jira-changelog
query: project = DEMO AND updated >= -1d
groupBy: author
```
````

Creates a swimlane for each author showing:
- Author avatar
- Author display name
- Change count

### Group by Author + Issue (Two-Level)

````markdown
```jira-changelog
query: project = DEMO AND sprint in openSprints()
groupBy: author+issue
```
````

Creates a two-level hierarchy:
- First level: Author with avatar
- Second level: Issues under each author

This is useful for reviewing what each team member worked on.

## Special Field Handling

### Comments

For Comment field changes, the changelog shows:
- **Added**: When a new comment is created
- **Edited**: When an existing comment is modified
- **Deleted**: When a comment is removed

### Attachments

For Attachment field changes:
- **Added**: When a file is attached
- **Removed**: When an attachment is deleted

## Display Columns

The changelog table includes these columns:

| Column | Description |
|--------|-------------|
| Time | Timestamp of the change |
| Issue | Issue key (clickable to open modal or Jira) |
| Author | User who made the change (with avatar) |
| Field | Name of the changed field |
| From | Previous value |
| To | New value |

When using `groupBy`, redundant columns are hidden within swimlanes.

## Examples

### Daily Standup Review

Review what changed in the current sprint yesterday:

````markdown
```jira-changelog
query: project = MOBILE AND sprint in openSprints()
period: 1d
groupBy: author
fields: status, assignee
limit: 50
```
````

### Monitor Status Changes

Track status transitions in real-time:

````markdown
```jira-changelog
query: project = SUPPORT AND updated >= -4h
fields: status
groupBy: issue
```
````

### Code Review Activity

See recent comment activity:

````markdown
```jira-changelog
query: project = BACKEND AND type = "Code Review"
period: 2d
fields: comment, status
groupBy: author+issue
```
````

### Team Activity Dashboard

Full activity log for the team:

````markdown
```jira-changelog
query: assignee in membersOf("Backend Team") AND updated >= -1w
period: 1w
groupBy: author
excludeFields: description
limit: 100
```
````

### Multi-Account Setup

Specify which Jira account to use:

````markdown
```jira-changelog
query: project = EXTERNAL
account: client-jira
period: 1d
groupBy: issue
```
````

## Interactive Features

### Refresh Button

Each changelog block has a refresh button in the footer. Clicking it:
1. Clears the cache for this query
2. Fetches fresh data from Jira
3. Re-renders the changelog

### Collapsible Swimlanes

When using `groupBy`:
- Click on swimlane headers to expand/collapse
- All swimlanes start expanded by default
- Toggle icon changes between chevron-down (expanded) and chevron-right (collapsed)

### Issue Links

Click on any issue key to open the Issue Detail Modal with full information.

## Footer Information

The changelog footer shows:
- **Total changes**: Count of visible changes
- **Period**: If period filter is active (e.g., "last 2h")
- **Account**: Which Jira account is being used
- **Last update**: When the data was cached
- **Refresh button**: Force refresh

## Commands

Insert a changelog template quickly:
1. Open Command Palette (Cmd/Ctrl+P)
2. Search for "Insert changelog template"
3. Press Enter

This inserts:

````markdown
```jira-changelog
query: project = DEMO AND updated >= -1d
period: 1d
groupBy: author
```
````

## Performance Tips

1. **Use period filter**: Limit changes to recent time windows
2. **Use limit**: Cap the number of issues fetched
3. **Specific JQL**: Narrow queries return faster
4. **Avoid large projects**: Filter by sprint, assignee, or date range

## Troubleshooting

### No Changes Displayed

If the changelog is empty:
1. Verify your JQL query returns issues in Jira
2. Check if the `period` filter is too restrictive
3. Ensure `fields` filter includes fields that changed
4. Confirm the account has permission to view changelogs

### Slow Performance

For large result sets:
1. Add a `limit` parameter
2. Use a shorter `period`
3. Refine JQL to match fewer issues
4. Enable rate limiting in account settings

### Permission Issues

Changelog data requires access to issue history. If you see errors:
1. Verify your Jira credentials have "Browse projects" permission
2. Some Jira instances may restrict changelog access
3. Check if the issues are in a project you can access

## Related Documentation

- [jira-search](./jira-search.md) - For table views without changelog
- [jira-kanban](./jira-kanban.md) - For board views
- [Configuration: Advanced](../configuration/advanced.md) - Performance tuning

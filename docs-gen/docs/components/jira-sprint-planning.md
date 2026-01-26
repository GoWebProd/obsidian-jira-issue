---
sidebar_position: 7
---

# jira-sprint-planning

Interactive sprint planning view for Scrum teams. Displays the next future sprint with team capacity tracking, drag-and-drop issue management, and sprint start functionality.

![Sprint Planning View](/img/sprint-planning.png)

## Basic Usage

The simplest sprint planning board requires a board ID and estimation field:

````markdown
```jira-sprint-planning
board: 123
estimationfield: customfield_10016
```
````

This displays:
- The next **future** sprint for the board
- All issues in the sprint backlog
- All issues in the product backlog
- Drag-and-drop between sprint and backlog

## Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `board` | number | *required* | Jira board ID (Scrum board) |
| `account` | string | first account | Account alias for multi-account setups |
| `estimationfield` | string | *required* | Field name for estimation (e.g., `customfield_10016`, `Story Points`, `timeoriginalestimate`) |
| `estimationtype` | `story_points`, `hours`, `days` | `story_points` | How to interpret and display estimation values |
| `hoursperday` | number | `8` | Hours per work day (used for time-based estimation formatting) |
| `excludetypes` | string | none | Comma-separated list of issue types to exclude (e.g., `Epic, Sub-task`) |
| `capacity` | block | none | Per-user capacity configuration (see [Capacity Planning](#capacity-planning)) |

## Finding Your Board ID

To find your Jira board ID:

1. Navigate to your Scrum board in Jira
2. Look at the URL: `https://your-jira.atlassian.net/jira/software/projects/PROJ/boards/123`
3. The number after `/boards/` is your board ID (e.g., `123`)

Alternatively:
1. Open board settings in Jira
2. The board ID is visible in the URL

**Important:** Sprint Planning only works with **Scrum boards**, not Kanban boards. The board must have sprints enabled.

## Estimation Configuration

### Story Points (Default)

For story point estimation (most common):

````markdown
```jira-sprint-planning
board: 123
estimationfield: Story Points
estimationtype: story_points
```
````

Or using custom field ID:

````markdown
```jira-sprint-planning
board: 123
estimationfield: customfield_10016
estimationtype: story_points
```
````

### Time-Based Estimation

For time tracking fields that store values in seconds:

````markdown
```jira-sprint-planning
board: 123
estimationfield: timeoriginalestimate
estimationtype: hours
hoursperday: 8
```
````

**Supported time fields:**
- `timeoriginalestimate` - Original Estimate
- `timeestimate` - Remaining Estimate
- `aggregatetimeoriginalestimate` - Aggregate Original Estimate

Time values are automatically converted from seconds:
- `estimationtype: hours` - displays as hours (e.g., "4h", "2d 4h")
- `estimationtype: days` - displays as days (e.g., "1.5d")

### Finding Your Estimation Field

1. Go to Settings → Jira Issue → [Your Account] → Custom Fields
2. Click "Refresh Custom Fields" to fetch from Jira
3. Find the field used for estimation (commonly named "Story Points" or "Story point estimate")
4. Use the field ID (e.g., `customfield_10016`) or exact field name

## Capacity Planning

The capacity block allows you to define work capacity for each team member. Capacity is specified in the same units as your estimation (story points, hours, or days).

### Syntax

````markdown
```jira-sprint-planning
board: 123
estimationfield: customfield_10016
estimationtype: story_points

capacity:
  John Doe: 20
  Jane Smith: 15
  Bob Johnson: 10
```
````

**Important:**
- Use the **display name** exactly as it appears in Jira (case-sensitive)
- Indent capacity entries with 2 spaces
- Capacity values must be non-negative numbers

### Capacity Features

When capacity is configured, the view displays:

1. **Capacity Cards** - One card per team member showing:
   - Avatar and name
   - Number of tasks assigned
   - Estimation assigned vs. capacity (e.g., "15 / 20")
   - Visual progress bar

2. **Over-Capacity Warnings** - When assigned > capacity:
   - Card highlighted in red/orange
   - Warning triangle icon
   - Progress bar shows overflow

3. **Total Summary** - Shows team totals:
   - Total tasks
   - Total estimation assigned
   - Total capacity (if configured)

### Dynamic Capacity Settings

Click the **settings icon** (⚙️) in the header to open the Capacity Settings modal:
- View all current assignees in the sprint
- Adjust capacity values without editing the code block
- Changes apply immediately to the view

## Filtering by Assignee

Click on any **capacity card** to filter issues by that assignee:

- **Single click** - Show only issues assigned to that person
- **Click again** - Clear filter and show all issues
- **"Show All" button** - Appears when filter is active, click to clear

Filtering applies to both Sprint Backlog and Product Backlog columns.

## Drag-and-Drop

Issues can be moved between sprint and backlog using drag-and-drop:

### Moving to Sprint
1. Drag an issue card from the **Product Backlog** column
2. Drop it into the **Sprint Backlog** column
3. The issue is added to the future sprint via Jira API
4. Capacity statistics update automatically

### Moving to Backlog
1. Drag an issue card from the **Sprint Backlog** column
2. Drop it into the **Product Backlog** column
3. The issue is removed from the sprint
4. Capacity statistics update automatically

**Note:** Drag-and-drop requires appropriate Jira permissions (ability to modify sprint membership).

## Start Sprint Modal

When viewing a **future** sprint, a "Start Sprint" button appears in the header.

### Starting a Sprint

1. Click **"Start Sprint"** button
2. In the modal:
   - **Sprint Name** - Pre-filled, can be edited
   - **Start Date** - Defaults to today
   - **End Date** - Required, typically 1-2 weeks from start
   - **Sprint Goal** - Optional description/objective
3. Click **"Start Sprint"** to confirm

The sprint will be started in Jira and the view will refresh to show the active sprint.

**Note:** Once started, the sprint becomes "active" and a new future sprint must be created in Jira for planning.

## Excluding Issue Types

Use `excludetypes` to hide certain issue types from the view:

````markdown
```jira-sprint-planning
board: 123
estimationfield: customfield_10016
excludetypes: Epic, Sub-task
```
````

Common use cases:
- Exclude **Epics** (they often don't have direct estimations)
- Exclude **Sub-tasks** (if you only want to see parent issues)
- Exclude **Spikes** or other non-deliverable types

## Interactive Features

All issue cards in sprint planning support the same interactive features as other components:

### Click to View Details

Click on any issue key to open the **Issue Detail Modal** with:
- Full description
- Linked issues
- All field information
- Sprint info and time tracking
- "Open in Jira" button

### Right-Click Context Menu

Right-click on any issue card for quick actions:
- **Add/Remove labels**
- **Change priority**
- **Change assignee**
- **Assign to custom fields**

All changes update immediately in Jira and the view refreshes.

## Examples

### Basic Sprint Planning

````markdown
```jira-sprint-planning
board: 42
estimationfield: Story Points
```
````

### Story Points with Team Capacity

````markdown
```jira-sprint-planning
board: 42
estimationfield: customfield_10016
estimationtype: story_points

capacity:
  Alice Developer: 21
  Bob Engineer: 18
  Carol Designer: 13
```
````

### Time-Based Planning (Hours)

````markdown
```jira-sprint-planning
board: 42
account: jira-cloud
estimationfield: timeoriginalestimate
estimationtype: hours
hoursperday: 8
excludetypes: Epic

capacity:
  Alice Developer: 60
  Bob Engineer: 48
```
````

### Multi-Account with Exclusions

````markdown
```jira-sprint-planning
board: 156
account: company-jira
estimationfield: customfield_10025
estimationtype: story_points
excludetypes: Epic, Bug, Spike

capacity:
  John Smith: 20
  Jane Doe: 20
  Mike Wilson: 15
```
````

## Troubleshooting

### "Board ID is required" Error

Ensure you specify a valid board ID:
```
board: 123
```

The board ID must be a positive integer.

### "Estimation field is required" Error

You must specify an estimation field:
```
estimationfield: customfield_10016
```

Or use the friendly name:
```
estimationfield: Story Points
```

### No Future Sprint Found

The view shows "No Future Sprint" when:
- No future sprints exist for the board
- All sprints are active or closed

**Solution:** Create a new sprint in Jira (Board → Backlog → Create Sprint).

### Issues Not Appearing

If issues are missing:

1. **Check board configuration** - Issues must be in the board's project/filter
2. **Check `excludetypes`** - You may be filtering out the issue type
3. **Check sprint membership** - Issue may not be in the sprint or backlog
4. **Refresh data** - Click the refresh button in the footer

### Capacity Not Matching

Capacity uses display names exactly as shown in Jira:
- ✅ `John Doe: 20` (matches "John Doe" in Jira)
- ❌ `johndoe: 20` (username won't match)
- ❌ `john doe: 20` (case mismatch)

Use the Capacity Settings modal (⚙️) to see exact names.

### Drag-and-Drop Not Working

1. **Check permissions** - You need permission to modify sprint membership in Jira
2. **Check sprint state** - Cannot modify closed or completed sprints
3. **Check browser console** - Look for API error messages

### Estimation Values Missing

If story points show as 0:
1. Verify the `estimationfield` parameter is correct
2. Check that issues actually have estimation values in Jira
3. Try using the custom field ID instead of friendly name

## Related Documentation

- [jira-kanban](./jira-kanban.md) - Kanban board view for active work
- [jira-search](./jira-search.md) - JQL-based issue tables
- [Configuration: Authentication](../configuration/authentication.md) - Multi-account setup
- [Configuration: Advanced](../configuration/advanced.md) - Performance tuning

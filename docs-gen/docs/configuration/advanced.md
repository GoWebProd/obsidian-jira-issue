---
sidebar_position: 4
---
# Advanced configuration
Other plugin settings.

## Cache time
To speed up the issues rendering and reduce the network usage, the plugin relies on a in-memory cache.

The cache stores the issues data and the JQL search results.
Every time a component is rendered, the plugin first check if the data is available in the cache and if not, it retrieves the data from the Jira server.

The items stored in the in-memory cache have an expiration date in order to periodically download updated information on the issues status and the search results. The default value is `15m`.

The syntax used to fill this field must be compatible with the [JavaScript library ms](https://github.com/vercel/ms#readme).

Examples

|Example|Description|
|-|-|
|`5s`|5 seconds|
|`1m`|1 minute|
|`2h`|2 hours|
|`1d`|1 day|

## Batch Request Management

The plugin automatically batches individual issue requests to improve performance and reduce API calls to your Jira server.

### Batch Delay (Per Account)

**Setting**: `batchDelayMs` (milliseconds)
**Default**: `150`
**Minimum**: `50`
**Location**: Settings → Jira Issue → [Account Name] → Batch Delay

When multiple issues are requested (e.g., a note with many inline issues), the plugin waits for this delay period to accumulate all requests before executing a single batch query.

**How it works:**
1. First issue request triggers a timer
2. Additional requests within the delay window are accumulated
3. After delay expires, all requests are deduplicated and grouped by account
4. A single JQL query fetches all issues: `key in (AAA-1, BBB-2, CCC-3, ...)`
5. Maximum 50 issues per batch (automatically chunked if more)

**Tuning recommendations:**
- **Lower delay (50-100ms)**: Faster individual issue rendering, more API calls
- **Higher delay (200-300ms)**: Fewer API calls, slight rendering delay on large notes
- **Very large notes (100+ issues)**: Consider 300-500ms to maximize batching

### Debug Batching

**Setting**: `debugBatching` (toggle)
**Default**: `false`
**Location**: Settings → Jira Issue → [Account Name] → Debug Batching

When enabled, the plugin logs detailed batching information to the Obsidian console:
- Number of requests accumulated
- Batch execution timing
- Number of issues fetched per batch
- Cache hit/miss statistics

Useful for diagnosing performance issues or understanding how batching affects your workflow.

## Rate Limiting (Per Account)

Rate limiting controls how frequently the plugin makes requests to your Jira server. This is configured independently for each account.

**Location**: Settings → Jira Issue → [Account Name] → Rate Limiting

### Enable Rate Limiting

**Setting**: `rateLimitEnabled` (toggle)
**Default**: `false`

When enabled, all requests for this account are queued and executed with controlled timing.

### Rate Limit Delay

**Setting**: `rateLimitDelayMs` (milliseconds)
**Default**: `1000` (1 second)

Minimum time between consecutive requests to Jira. The plugin enforces this delay between all API calls (batch queries, user searches, issue updates).

**Example:** With `delayMs: 500`, the plugin waits at least 500ms between each request. If 5 batches are queued, they execute at 0ms, 500ms, 1000ms, 1500ms, 2000ms.

### Concurrent Requests

**Setting**: `rateLimitConcurrent` (number)
**Default**: `5`

Maximum number of simultaneous requests allowed to Jira. When this limit is reached, additional requests wait in queue.

**Example:** With `concurrent: 3`:
- Requests 1, 2, 3 execute immediately
- Request 4 waits until one of 1-3 completes
- Request 5 waits until two slots are available

**Note:** Batch queries (fetching issues) and individual operations (updating labels, priority) share the same concurrency limit.

## Recommended Settings by Use Case

### High-Performance Mode (Many Issues, Conservative API Usage)

Best for notes with 50+ issues or strict API rate limits:

```
batchDelayMs: 300
debugBatching: false
rateLimitEnabled: true
rateLimitDelayMs: 500
rateLimitConcurrent: 3
```

**Benefits:**
- Maximum batching efficiency (fewer API calls)
- Controlled request rate
- Lower server load

**Trade-off:** 300ms delay before issues start rendering

### Real-Time Mode (Immediate Updates)

Best for small notes or when you need instant issue rendering:

```
batchDelayMs: 50
debugBatching: false
rateLimitEnabled: false
rateLimitDelayMs: 1000
rateLimitConcurrent: 5
```

**Benefits:**
- Fastest possible rendering
- Minimal perceived delay

**Trade-off:** More API calls, may hit rate limits on large notes

### Debugging Mode

When troubleshooting performance or batching issues:

```
batchDelayMs: 150
debugBatching: true
rateLimitEnabled: true
rateLimitDelayMs: 1000
rateLimitConcurrent: 3
```

Open Obsidian Developer Console (Cmd/Ctrl+Shift+I) to view batching logs.

### Enterprise Jira with Strict Limits

For Jira instances with aggressive API rate limiting:

```
batchDelayMs: 500
debugBatching: false
rateLimitEnabled: true
rateLimitDelayMs: 2000
rateLimitConcurrent: 2
```

**Benefits:**
- Maximum batching (fewest API calls)
- 2-second delay between requests prevents hitting rate limits
- Only 2 concurrent requests reduces server load

**Trade-off:** Slower rendering, especially on large notes

## Debug mode
In order to help users debug authentication issues and provide useful information when submitting new Issues on GitHub, the plugin provides a way to increase the debug information in the Obsidian.md console.

The `Log Requests and Responses` option allow to display in the console all the request and responses exchanged with the Jira Server.

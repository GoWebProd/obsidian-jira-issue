export interface IQueueConfig {
    delayMs: number        // Delay between requests in milliseconds
    concurrent: number     // Number of concurrent requests (1 = sequential)
}

export interface IQueuedRequest<T> {
    fn: () => Promise<T>
    resolve: (value: T) => void
    reject: (error: any) => void
}

/**
 * Request Queue with fixed delay between requests.
 * All requests are executed sequentially with a configurable delay between them.
 */
export class RequestQueue {
    private config: IQueueConfig
    private queue: IQueuedRequest<any>[] = []
    private activeCount = 0
    private lastExecutionTime = 0

    constructor(config: IQueueConfig) {
        this.config = config
    }

    /**
     * Add a request to the queue and execute it when its turn comes.
     */
    async add<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject })
            this.process()
        })
    }

    /**
     * Process the queue, executing requests based on concurrency limit and delay.
     */
    private async process(): Promise<void> {
        // If we've reached the concurrency limit or queue is empty, stop
        if (this.activeCount >= this.config.concurrent || this.queue.length === 0) {
            return
        }

        // Get the next request from the queue
        const request = this.queue.shift()
        if (!request) {
            return
        }

        this.activeCount++

        // Wait for the required delay since the last execution
        const now = Date.now()
        const timeSinceLastExecution = now - this.lastExecutionTime
        if (timeSinceLastExecution < this.config.delayMs) {
            await this.sleep(this.config.delayMs - timeSinceLastExecution)
        }

        this.lastExecutionTime = Date.now()

        try {
            const result = await request.fn()
            request.resolve(result)
        } catch (error) {
            request.reject(error)
        } finally {
            this.activeCount--
            // Process next item in queue
            this.process()
        }
    }

    /**
     * Update the configuration of this queue.
     * Useful when settings change.
     */
    updateConfig(config: IQueueConfig): void {
        this.config = config
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}

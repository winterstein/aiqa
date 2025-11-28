"use strict";
/**
 * OpenTelemetry span exporter that sends spans to the AIQA server API.
 * Buffers spans and flushes them periodically or on shutdown. Thread-safe.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIQASpanExporter = void 0;
const core_1 = require("@opentelemetry/core");
/**
 * Exports spans to AIQA server. Buffers spans and auto-flushes every flushIntervalSeconds.
 * Call shutdown() before process exit to flush remaining spans.
 */
class AIQASpanExporter {
    constructor(serverUrl = 'http://localhost:3000', apiKey = process.env.AIQA_API_KEY || '', flushIntervalSeconds = 5) {
        this.buffer = [];
        this.flushLock = Promise.resolve();
        this.shutdownRequested = false;
        this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
        this.apiKey = apiKey;
        this.flushIntervalMs = flushIntervalSeconds * 1000;
        this.startAutoFlush();
    }
    export(spans, resultCallback) {
        if (spans.length === 0) {
            resultCallback({ code: core_1.ExportResultCode.SUCCESS });
            return;
        }
        // Call callback immediately to avoid timeout
        resultCallback({ code: core_1.ExportResultCode.SUCCESS });
        // Add spans to buffer (thread-safe)
        this.addToBuffer(spans);
    }
    /**
     * Add spans to the buffer in a thread-safe manner
     */
    addToBuffer(spans) {
        const serializedSpans = spans.map(span => this.serializeSpan(span));
        this.buffer.push(...serializedSpans);
    }
    /**
     * Convert ReadableSpan to a serializable format
     */
    serializeSpan(span) {
        const spanContext = span.spanContext();
        return {
            name: span.name,
            kind: span.kind,
            parentSpanId: span.parentSpanId,
            startTime: span.startTime,
            endTime: span.endTime,
            status: {
                code: span.status.code,
                message: span.status.message,
            },
            attributes: span.attributes,
            links: span.links.map(link => ({
                context: {
                    traceId: link.context.traceId,
                    spanId: link.context.spanId,
                },
                attributes: link.attributes,
            })),
            events: span.events.map(event => ({
                name: event.name,
                time: event.time,
                attributes: event.attributes,
            })),
            resource: {
                attributes: span.resource.attributes,
            },
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
            traceFlags: spanContext.traceFlags,
            duration: span.duration,
            ended: span.ended,
            instrumentationLibrary: span.instrumentationLibrary,
        };
    }
    /**
     * Flush buffered spans to the server. Thread-safe: ensures only one flush operation runs at a time.
     */
    async flush() {
        // Wait for any ongoing flush to complete
        await this.flushLock;
        // Create a new lock for this flush operation
        let resolveFlush;
        this.flushLock = new Promise(resolve => {
            resolveFlush = resolve;
        });
        try {
            // Get current buffer and clear it atomically
            const spansToFlush = this.buffer.splice(0);
            if (spansToFlush.length === 0) {
                return;
            }
            // Skip sending if server URL is not configured
            if (!this.serverUrl) {
                console.warn(`Skipping flush: AIQA_SERVER_URL is not set. ${spansToFlush.length} span(s) will not be sent.`);
                return;
            }
            await this.sendSpans(spansToFlush);
        }
        catch (error) {
            console.error('Error flushing spans to server:', error.message);
            // Don't throw in auto-flush to avoid crashing the process
            if (this.shutdownRequested) {
                throw error;
            }
        }
        finally {
            resolveFlush();
        }
    }
    /**
     * Send spans to the server API
     */
    async sendSpans(spans) {
        if (!this.serverUrl) {
            throw new Error('AIQA_SERVER_URL is not set. Cannot send spans to server.');
        }
        console.log('Sending spans to server:', this.serverUrl, spans, this.apiKey);
        const response = await fetch(`${this.serverUrl}/span`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `ApiKey ${this.apiKey}`,
            },
            body: JSON.stringify(spans),
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Failed to send spans: ${response.status} ${response.statusText} - ${errorText}`);
        }
    }
    /**
     * Start the auto-flush timer
     */
    startAutoFlush() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        this.flushTimer = setInterval(() => {
            if (!this.shutdownRequested) {
                this.flush().catch((error) => {
                    console.error('Error in auto-flush:', error.message);
                });
            }
        }, this.flushIntervalMs);
        // Unref the timer so it doesn't prevent process exit
        // This allows the exporter to work as a daemon that won't block normal exit
        if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
            this.flushTimer.unref();
        }
    }
    /**
     * Shutdown the exporter, flushing any remaining spans. Call before process exit.
     */
    async shutdown() {
        this.shutdownRequested = true;
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
        // Flush any remaining spans
        await this.flush();
    }
}
exports.AIQASpanExporter = AIQASpanExporter;

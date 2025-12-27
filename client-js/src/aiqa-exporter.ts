/**
 * OpenTelemetry span exporter that sends spans to the AIQA server API.
 * Buffers spans and flushes them periodically or on shutdown. Thread-safe.
 */

import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';

interface SerializableSpan {
  name: string;
  kind: number;
  parentSpanId?: string;
  startTime: [number, number];
  endTime: [number, number];
  status: {
    code: number;
    message?: string;
  };
  attributes: Record<string, any>;
  links: Array<{
    context: {
      traceId: string;
      spanId: string;
    };
    attributes?: Record<string, any>;
  }>;
  events: Array<{
    name: string;
    time: [number, number];
    attributes?: Record<string, any>;
  }>;
  resource: {
    attributes: Record<string, any>;
  };
  traceId: string;
  spanId: string;
  traceFlags: number;
  duration: [number, number];
  ended: boolean;
  instrumentationLibrary: {
    name: string;
    version?: string;
  };
}

/**
 * Exports spans to AIQA server. Buffers spans and auto-flushes every flushIntervalSeconds.
 * Call shutdown() before process exit to flush remaining spans.
 */
export class AIQASpanExporter implements SpanExporter {
  private serverUrl: string;
  private apiKey: string;
  private flushIntervalMs: number;
  private buffer: SerializableSpan[] = [];
  private flushTimer?: NodeJS.Timeout;
  private flushLock: Promise<void> = Promise.resolve();
  private shutdownRequested: boolean = false;

  constructor(
    serverUrl: string = 'http://localhost:3000',
    apiKey: string = process.env.AIQA_API_KEY || '',
    flushIntervalSeconds: number = 5
  ) {
    this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
    this.flushIntervalMs = flushIntervalSeconds * 1000;
    this.startAutoFlush();
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (spans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    // Call callback immediately to avoid timeout
    resultCallback({ code: ExportResultCode.SUCCESS });
    
    // Add spans to buffer (thread-safe)
    this.addToBuffer(spans);
  }

  /**
   * Add spans to the buffer in a thread-safe manner
   */
  private addToBuffer(spans: ReadableSpan[]): void {
    const serializedSpans = spans.map(span => this.serializeSpan(span));
    this.buffer.push(...serializedSpans);
  }

  /**
   * Get enabled filters from AIQA_DATA_FILTERS env var
   */
  private getEnabledFilters(): Set<string> {
    const filtersEnv = process.env.AIQA_DATA_FILTERS || "RemovePasswords, RemoveJWT";
    if (!filtersEnv) {
      return new Set();
    }
    return new Set(filtersEnv.split(',').map(f => f.trim()).filter(f => f));
  }

  /**
   * Check if a value looks like a JWT token
   */
  private isJWTToken(value: any): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    // JWT tokens have format: header.payload.signature (3 parts separated by dots)
    // They typically start with "eyJ" (base64 encoded '{"')
    const parts = value.split('.');
    return parts.length === 3 && value.startsWith('eyJ') && parts.every(p => p.length > 0);
  }

  /**
   * Check if a value looks like an API key
   */
  private isAPIKey(value: any): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    const trimmed = value.trim();
    // Common API key prefixes
    const apiKeyPrefixes = ['sk-', 'pk-', 'AKIA', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];
    return apiKeyPrefixes.some(prefix => trimmed.startsWith(prefix));
  }

  /**
   * Apply data filters to a key-value pair
   */
  private applyDataFilters(key: string, value: any): any {
    // Don't filter falsy values
    if (!value) {
      return value;
    }
    
    const enabledFilters = this.getEnabledFilters();
    const keyLower = key.toLowerCase();
    
    // RemovePasswords filter: if key contains "password", replace value with "****"
    if (enabledFilters.has('RemovePasswords') && keyLower.includes('password')) {
      return '****';
    }
    
    // RemoveJWT filter: if value looks like a JWT token, replace with "****"
    if (enabledFilters.has('RemoveJWT') && this.isJWTToken(value)) {
      return '****';
    }
    
    // RemoveAuthHeaders filter: if key is "authorization" (case-insensitive), replace value with "****"
    if (enabledFilters.has('RemoveAuthHeaders') && keyLower === 'authorization') {
      return '****';
    }
    
    // RemoveAPIKeys filter: if key contains API key patterns or value looks like an API key
    if (enabledFilters.has('RemoveAPIKeys')) {
      // Check key patterns
      const apiKeyKeyPatterns = ['api_key', 'apikey', 'api-key', 'apikey'];
      if (apiKeyKeyPatterns.some(pattern => keyLower.includes(pattern))) {
        return '****';
      }
      // Check value patterns
      if (this.isAPIKey(value)) {
        return '****';
      }
    }
    
    return value;
  }

  /**
   * Recursively apply data filters to nested structures
   */
  private filterDataRecursive(data: any): any {
    if (data == null) {
      return data;
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.filterDataRecursive(item));
    }
    
    if (typeof data === 'object') {
      const result: any = {};
      for (const [k, v] of Object.entries(data)) {
        const filteredValue = this.applyDataFilters(k, v);
        result[k] = this.filterDataRecursive(filteredValue);
      }
      return result;
    }
    
    return this.applyDataFilters('', data);
  }

  /**
   * Convert ReadableSpan to a serializable format
   */
  private serializeSpan(span: ReadableSpan): SerializableSpan {
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
      attributes: this.filterDataRecursive(span.attributes),
      links: span.links.map(link => ({
        context: {
          traceId: link.context.traceId,
          spanId: link.context.spanId,
        },
        attributes: this.filterDataRecursive(link.attributes),
      })),
      events: span.events.map(event => ({
        name: event.name,
        time: event.time,
        attributes: this.filterDataRecursive(event.attributes),
      })),
      resource: {
        attributes: this.filterDataRecursive(span.resource.attributes),
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
  async flush(): Promise<void> {
    // Wait for any ongoing flush to complete
    await this.flushLock;

    // Create a new lock for this flush operation
    let resolveFlush: () => void;
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
        console.warn(`AIQA: Skipping flush: AIQA_SERVER_URL is not set. ${spansToFlush.length} span(s) will not be sent.`);
        return;
      }

      await this.sendSpans(spansToFlush);
    } catch (error: any) {
      console.error('AIQA: Error flushing spans to server:', error.message);
      // Don't throw in auto-flush to avoid crashing the process
      if (this.shutdownRequested) {
        throw error;
      }
    } finally {
      resolveFlush!();
    }
  }

  /**
   * Send spans to the server API
   */
  private async sendSpans(spans: SerializableSpan[]): Promise<void> {
    if (!this.serverUrl) {
      throw new Error('AIQA_SERVER_URL is not set. Cannot send spans to server.');
    }

	console.log('AIQA: Sending spans to server:', this.serverUrl, spans, this.apiKey);
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
  private startAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (!this.shutdownRequested) {
        this.flush().catch((error: any) => {
          console.error('AIQA: Error in auto-flush:', error.message);
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
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    // Flush any remaining spans
    await this.flush();
  }
}

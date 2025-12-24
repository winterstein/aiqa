/**
 * OpenTelemetry tracing setup and utilities. Initializes tracer provider on import.
 * Provides withTracingAsync and withTracing decorators to automatically trace function calls.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { trace, context, SpanStatusCode, SpanContext, TraceFlags } from '@opentelemetry/api';
import { propagation } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { ATTR_CODE_FUNCTION_NAME, SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { AIQASpanExporter } from './aiqa-exporter';

// Load environment variables from .env file in client-js directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Get sampling rate from environment (default: 1.0 = sample all)
let samplingRate = 1.0;
if (process.env.AIQA_SAMPLING_RATE) {
	const rate = parseFloat(process.env.AIQA_SAMPLING_RATE);
	if (!isNaN(rate)) {
		samplingRate = Math.max(0, Math.min(1, rate)); // Clamp to [0, 1]
	}
}

// Component tag to add to all spans (can be set via AIQA_COMPONENT_TAG env var or programmatically)
let componentTag: string = process.env.AIQA_COMPONENT_TAG || "";

// Initialize OpenTelemetry with AIQA exporter
const aiqaServerUrl = process.env.AIQA_SERVER_URL;
const exporter = new AIQASpanExporter(aiqaServerUrl);

// Check if a TracerProvider is already registered
const existingProvider = trace.getTracerProvider();

// Check if it's a real SDK provider (has addSpanProcessor method) or just the default NoOp provider
const isRealProvider = existingProvider && typeof (existingProvider as any).addSpanProcessor === 'function';

let provider: NodeTracerProvider;

if (!isRealProvider) {
	// No real provider exists, create a new one
	provider = new NodeTracerProvider({
		resource: new Resource({
			[SEMRESATTRS_SERVICE_NAME]: 'example-service',
		}),
		sampler: new TraceIdRatioBasedSampler(samplingRate),
	});
	
	provider.addSpanProcessor(new BatchSpanProcessor(exporter));
	provider.register();
} else {
	// Real provider already exists, just add our span processor to it
	// Check if we've already added our processor to avoid duplicates
	provider = existingProvider as NodeTracerProvider;
	let processorAlreadyAdded = false;
	
	// Try to check if our exporter is already in the processor list
	// Note: This is a best-effort check since we can't easily inspect internal processors
	try {
		const processors = (provider as any)._spanProcessors;
		if (processors) {
			for (const proc of processors) {
				if (proc && proc._exporter === exporter) {
					processorAlreadyAdded = true;
					break;
				}
			}
		}
	} catch (e) {
		// If we can't check, assume it's not added and proceed
	}
	
	if (!processorAlreadyAdded) {
		provider.addSpanProcessor(new BatchSpanProcessor(exporter));
	}
}

// Getting a tracer with the same name ('example-tracer') simply returns a tracer instance;
// it does NOT link spans automatically within the same trace.
// Each time you start a new root span (span without a parent), a new trace-id is generated.
// Spans only share a trace-id if they are started as children of the same trace context.

const tracer = trace.getTracer('example-tracer');

/**
 * Flush all pending spans to the server.
 * Flushes also happen automatically every few seconds. So you only need to call this function 
 * if you want to flush immediately, e.g. before exiting a process.
 * 
 * This flushes both the BatchSpanProcessor and the exporter buffer.
 * 
 */
export async function flushSpans(): Promise<void> {
	if (provider) {
		await provider.forceFlush();
	}
	await exporter.flush();
}

/**
 * Shutdown the tracer provider and exporter. 
 * It is not necessary to call this function.
 * Note: If using with an existing TracerProvider, this will shutdown the entire provider,
 * which may affect other tracing systems. Use with caution.
 */
export async function shutdownTracing(): Promise<void> {
	if (provider) {
		await provider.shutdown();
	}
	await exporter.shutdown();
}

// Export provider and exporter for advanced usage
export { provider, exporter };

/**
 * Options for withTracing and withTracingAsync functions
 */
export interface TracingOptions {
	name?: string;
	ignoreInput?: any;
	ignoreOutput?: any;
	filterInput?: (input: any) => any;
	filterOutput?: (output: any) => any;
}

/**
 * Wrap async function to automatically create spans. Records input/output as span attributes.
 * Spans are automatically linked via OpenTelemetry context.
 */
export function withTracingAsync(fn: Function, options: TracingOptions = {}) {
	const { name, ignoreInput, ignoreOutput, filterInput, filterOutput } = options;
	let fnName = name || fn.name || "_";
	if ((fn as any)._isTraced) {
		console.warn('Function ' + fnName + ' is already traced, skipping tracing again');
		return fn;
	}
	const tracedFn = async (...args: any[]) => {
		const span = tracer.startSpan(fnName);
		
		// Set component tag if configured
		if (componentTag) {
			span.setAttribute('component', componentTag);
		}
		
		// Trace inputs using input. attributes
		let input = args;
		if (args.length === 0) {
			input = null;
		} else if (args.length === 1) {
			input = args[0];
		}
		if (filterInput) {
			input = filterInput(input);
		}
		if (ignoreInput && typeof input === 'object') {
			// TODO make a copy of input removing fields in ignoreInput
		}
		if (input != null) {
			span.setAttribute('input', input);
		}
		try {
			// call the function
			const traceId = span.spanContext().traceId;
			console.log('do traceable stuff', { fnName, traceId });
			const curriedFn = () => fn(...args)
			const result = await context.with(trace.setSpan(context.active(), span), curriedFn);
			// Trace output
			let output = result;
			if (filterOutput) {
				output = filterOutput(output);
			}
			if (ignoreOutput && typeof output === 'object') {
				// TODO make a copy of output removing fields in ignoreOutput
			}
			// Extract and set token usage before setting output
			extractAndSetTokenUsage(span, output);
			// Extract and set provider/model before setting output
			extractAndSetProviderAndModel(span, output);
			span.setAttribute('output', output);

			return result;
		} catch (exception) {
			const error = exception instanceof Error ? exception : new Error(String(exception));
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			throw error; // Re-throw to maintain error propagation		  
		} finally {
			span.end();
		}
	};
	tracedFn._isTraced = true; // avoid double wrapping
	console.log('Function ' + fnName + ' is now traced');
	return tracedFn;
}


/**
 * Wrap synchronous function to automatically create spans. Records input/output as span attributes.
 * Spans are automatically linked via OpenTelemetry context.
 */
export function withTracing(fn: Function, options: TracingOptions = {}) {	
	const { name, ignoreInput, ignoreOutput, filterInput, filterOutput } = options;
	let fnName = name || fn.name || "_";
	if ((fn as any)._isTraced) {
		console.warn('Function ' + fnName + ' is already traced, skipping tracing again');
		return fn;
	}
	const tracedFn = (...args: any[]) => {
		const span = tracer.startSpan(fnName);
		
		// Set component tag if configured
		if (componentTag) {
			span.setAttribute('component', componentTag);
		}
		
		// Trace inputs using input. attributes
		let input = args;
		if (args.length === 0) {
			input = null;
		} else if (args.length === 1) {
			input = args[0];
		}
		if (filterInput) {
			input = filterInput(input);
		}
		if (ignoreInput && typeof input === 'object') {
			// TODO make a copy of input removing fields in ignoreInput
		}
		if (input != null) {
			span.setAttribute('input', input);
		}
		try {
			// call the function
			const traceId = span.spanContext().traceId;
			console.log('do traceable stuff', { fnName, traceId });
			const curriedFn = () => fn(...args)
			const result = context.with(trace.setSpan(context.active(), span), curriedFn);
			// Trace output
			let output = result;
			if (filterOutput) {
				output = filterOutput(output);
			}
			if (ignoreOutput && typeof output === 'object') {
				// TODO make a copy of output removing fields in ignoreOutput
			}
			// Extract and set token usage before setting output
			extractAndSetTokenUsage(span, output);
			// Extract and set provider/model before setting output
			extractAndSetProviderAndModel(span, output);
			span.setAttribute('output', output);

			return result;
		} catch (exception) {
			const error = exception instanceof Error ? exception : new Error(String(exception));
			span.recordException(error);
			span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
			throw error; // Re-throw to maintain error propagation		  
		} finally {
			span.end();
		}
	};
	tracedFn._isTraced = true; // avoid double wrapping
	console.log('Function ' + fnName + ' is now traced');
	return tracedFn;
}



export function setSpanAttribute(attributeName: string, attributeValue: any) {
	let span = trace.getActiveSpan();
	if (span) {
		span.setAttribute(attributeName, attributeValue);
		return true
	}
	return false; // no span found
}

/**
 * Check if an attribute is already set on a span.
 * Returns true if the attribute exists, false otherwise.
 * Safe against exceptions.
 */
function isAttributeSet(span: any, attributeName: string): boolean {
	try {
		// Try to access span attributes if available
		if (span.attributes) {
			return attributeName in span.attributes;
		}
		// Fallback: check if span has a way to get attributes
		// OpenTelemetry spans don't expose a direct getter, so we return false
		// to allow setting (conservative approach)
		return false;
	} catch (e) {
		// If anything goes wrong, assume not set (conservative approach)
		return false;
	}
}

/**
 * Extract OpenAI API style token usage from result and add to span attributes
 * using OpenTelemetry semantic conventions for gen_ai.
 * Only sets attributes that are not already set.
 * 
 * This function detects token usage from OpenAI API response patterns:
 * - OpenAI Chat Completions API: The 'usage' object contains 'prompt_tokens', 'completion_tokens', and 'total_tokens'.
 *   See https://platform.openai.com/docs/api-reference/chat/object (usage field)
 * - OpenAI Completions API: The 'usage' object contains 'prompt_tokens', 'completion_tokens', and 'total_tokens'.
 *   See https://platform.openai.com/docs/api-reference/completions/object (usage field)
 * 
 * This function is safe against exceptions and will not derail tracing or program execution.
 */
function extractAndSetTokenUsage(span: any, result: any): void {
	try {
		if (!span || !span.isRecording || !span.isRecording()) {
			return;
		}
		
		let usage: any = null;
		
		// Check if result is an object with 'usage' key
		try {
			if (result && typeof result === 'object') {
				if ('usage' in result) {
					usage = result.usage;
				} else if ('Usage' in result) {
					usage = result.Usage;
				} else {
					// Check if result itself is a usage dict
					if ('prompt_tokens' in result && 'completion_tokens' in result && 'total_tokens' in result) {
						usage = result;
					} else if ('PromptTokens' in result && 'CompletionTokens' in result && 'TotalTokens' in result) {
						usage = result;
					}
				}
			}
		} catch (e) {
			// If accessing result properties fails, just return silently
			return;
		}
		
		// Extract token usage if found
		if (usage && typeof usage === 'object') {
			try {
				const promptTokens = usage.prompt_tokens ?? usage.PromptTokens;
				const completionTokens = usage.completion_tokens ?? usage.CompletionTokens;
				const totalTokens = usage.total_tokens ?? usage.TotalTokens;
				
				// Only set attributes that are not already set
				if (promptTokens != null && !isAttributeSet(span, 'gen_ai.usage.input_tokens')) {
					span.setAttribute('gen_ai.usage.input_tokens', Number(promptTokens));
				}
				if (completionTokens != null && !isAttributeSet(span, 'gen_ai.usage.output_tokens')) {
					span.setAttribute('gen_ai.usage.output_tokens', Number(completionTokens));
				}
				if (totalTokens != null && !isAttributeSet(span, 'gen_ai.usage.total_tokens')) {
					span.setAttribute('gen_ai.usage.total_tokens', Number(totalTokens));
				}
			} catch (e) {
				// If setting attributes fails, log but don't raise
				console.debug('Failed to set token usage attributes on span', e);
			}
		}
	} catch (e) {
		// Catch any other exceptions to ensure this never derails tracing
		console.debug('Error in extractAndSetTokenUsage', e);
	}
}

/**
 * Extract provider and model information from result and add to span attributes
 * using OpenTelemetry semantic conventions for gen_ai.
 * Only sets attributes that are not already set.
 * 
 * This function detects model information from common API response patterns:
 * - OpenAI Chat Completions API: The 'model' field is at the top level of the response.
 *   See https://platform.openai.com/docs/api-reference/chat/object
 * - OpenAI Completions API: The 'model' field is at the top level of the response.
 *   See https://platform.openai.com/docs/api-reference/completions/object
 * 
 * This function is safe against exceptions and will not derail tracing or program execution.
 */
function extractAndSetProviderAndModel(span: any, result: any): void {
	try {
		if (!span || !span.isRecording || !span.isRecording()) {
			return;
		}
		
		let model: any = null;
		let provider: any = null;
		
		// Check if result is an object
		try {
			if (result && typeof result === 'object') {
				model = result.model ?? result.Model;
				provider = result.provider ?? result.Provider ?? result.provider_name ?? result.providerName;
				
				// Check nested structures (e.g., response.data.model)
				if (model == null && result.data) {
					const data = result.data;
					if (typeof data === 'object') {
						model = data.model ?? data.Model;
					}
				}
				
				// Check for model in choices (OpenAI pattern)
				if (model == null && Array.isArray(result.choices) && result.choices.length > 0) {
					const firstChoice = result.choices[0];
					if (firstChoice && typeof firstChoice === 'object') {
						model = firstChoice.model ?? firstChoice.Model;
					}
				}
			}
		} catch (e) {
			// If accessing result properties fails, just return silently
			return;
		}
		
		// Set attributes if found and not already set
		if (model != null && !isAttributeSet(span, 'gen_ai.request.model')) {
			try {
				const modelStr = String(model);
				if (modelStr) {
					span.setAttribute('gen_ai.request.model', modelStr);
				}
			} catch (e) {
				console.debug('Failed to set model attribute on span', e);
			}
		}
		
		if (provider != null && !isAttributeSet(span, 'gen_ai.provider.name')) {
			try {
				const providerStr = String(provider);
				if (providerStr) {
					span.setAttribute('gen_ai.provider.name', providerStr);
				}
			} catch (e) {
				console.debug('Failed to set provider attribute on span', e);
			}
		}
	} catch (e) {
		// Catch any other exceptions to ensure this never derails tracing
		console.debug('Error in extractAndSetProviderAndModel', e);
	}
}

export function getActiveSpan() {
	return trace.getActiveSpan();
}

/**
 * Set the gen_ai.conversation.id attribute on the active span.
 * This allows you to group multiple traces together that are part of the same conversation.
 * See https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/ for more details.
 * 
 * @param conversationId - A unique identifier for the conversation (e.g., user session ID, chat ID, etc.)
 * @returns True if gen_ai.conversation.id was set, False if no active span found
 * 
 * @example
 * ```typescript
 * import { withTracing, setConversationId } from './src/tracing';
 * 
 * const tracedFn = withTracing(function handleUserRequest(userId: string, request: any) {
 *   // Set conversation ID to group all traces for this user session
 *   setConversationId(`user_${userId}_session_${request.sessionId}`);
 *   // ... rest of function
 * });
 * ```
 */
export function setConversationId(conversationId: string): boolean {
	return setSpanAttribute('gen_ai.conversation.id', conversationId);
}

/**
 * Set token usage attributes on the active span using OpenTelemetry semantic conventions for gen_ai.
 * This allows you to explicitly record token usage information.
 * See https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ for more details.
 * 
 * @param inputTokens - Number of input tokens used (maps to gen_ai.usage.input_tokens)
 * @param outputTokens - Number of output tokens generated (maps to gen_ai.usage.output_tokens)
 * @param totalTokens - Total number of tokens used (maps to gen_ai.usage.total_tokens)
 * @returns True if at least one token usage attribute was set, False if no active span found
 * 
 * @example
 * ```typescript
 * import { withTracing, setTokenUsage } from './src/tracing';
 * 
 * const tracedFn = withTracing(function callLLM(prompt: string) {
 *   const response = await openaiClient.chat.completions.create(...);
 *   // Explicitly set token usage
 *   setTokenUsage(
 *     response.usage.prompt_tokens,
 *     response.usage.completion_tokens,
 *     response.usage.total_tokens
 *   );
 *   return response;
 * });
 * ```
 */
export function setTokenUsage(
	inputTokens?: number | null,
	outputTokens?: number | null,
	totalTokens?: number | null
): boolean {
	const span = trace.getActiveSpan();
	if (!span) {
		return false;
	}
	
	let setCount = 0;
	try {
		if (inputTokens != null) {
			span.setAttribute('gen_ai.usage.input_tokens', Number(inputTokens));
			setCount++;
		}
		if (outputTokens != null) {
			span.setAttribute('gen_ai.usage.output_tokens', Number(outputTokens));
			setCount++;
		}
		if (totalTokens != null) {
			span.setAttribute('gen_ai.usage.total_tokens', Number(totalTokens));
			setCount++;
		}
	} catch (e) {
		console.warn('Failed to set token usage attributes:', e);
		return false;
	}
	
	return setCount > 0;
}

/**
 * Set provider and model attributes on the active span using OpenTelemetry semantic conventions for gen_ai.
 * This allows you to explicitly record provider and model information.
 * See https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ for more details.
 * 
 * @param provider - Name of the AI provider (e.g., "openai", "anthropic", "google") (maps to gen_ai.provider.name)
 * @param model - Name of the model used (e.g., "gpt-4", "claude-3-5-sonnet") (maps to gen_ai.request.model)
 * @returns True if at least one attribute was set, False if no active span found
 * 
 * @example
 * ```typescript
 * import { withTracing, setProviderAndModel } from './src/tracing';
 * 
 * const tracedFn = withTracing(function callLLM(prompt: string) {
 *   const response = await openaiClient.chat.completions.create(...);
 *   // Explicitly set provider and model
 *   setProviderAndModel("openai", response.model);
 *   return response;
 * });
 * ```
 */
export function setProviderAndModel(
	provider?: string | null,
	model?: string | null
): boolean {
	const span = trace.getActiveSpan();
	if (!span) {
		return false;
	}
	
	let setCount = 0;
	try {
		if (provider != null && provider !== '') {
			span.setAttribute('gen_ai.provider.name', String(provider));
			setCount++;
		}
		if (model != null && model !== '') {
			span.setAttribute('gen_ai.request.model', String(model));
			setCount++;
		}
	} catch (e) {
		console.warn('Failed to set provider/model attributes:', e);
		return false;
	}
	
	return setCount > 0;
}

/**
 * Set the component tag that will be added to all spans created by AIQA.
 * This can also be set via the AIQA_COMPONENT_TAG environment variable.
 * The component tag allows you to identify which component/system generated the spans.
 * 
 * @param tag - A component identifier (e.g., "mynamespace.mysystem", "backend.api", etc.)
 * 
 * @example
 * ```typescript
 * import { setComponentTag } from './src/tracing';
 * 
 * // Set component tag programmatically
 * setComponentTag("mynamespace.mysystem");
 * 
 * // Or set via environment variable:
 * // export AIQA_COMPONENT_TAG="mynamespace.mysystem"
 * ```
 */
export function setComponentTag(tag: string): void {
	componentTag = tag;
}

/**
 * Get the current trace ID as a hexadecimal string (32 characters).
 * 
 * @returns The trace ID as a hex string, or undefined if no active span exists.
 * 
 * @example
 * ```typescript
 * const traceId = getTraceId();
 * // Pass traceId to another service/agent
 * // e.g., include in HTTP headers, message queue metadata, etc.
 * ```
 */
export function getTraceId(): string | undefined {
	const span = trace.getActiveSpan();
	if (span) {
		const spanContext = span.spanContext();
		if (spanContext.traceId && spanContext.traceId !== '00000000000000000000000000000000') {
			return spanContext.traceId;
		}
	}
	return undefined;
}

/**
 * Get the current span ID as a hexadecimal string (16 characters).
 * 
 * @returns The span ID as a hex string, or undefined if no active span exists.
 * 
 * @example
 * ```typescript
 * const spanId = getSpanId();
 * // Can be used to create child spans in other services
 * ```
 */
export function getSpanId(): string | undefined {
	const span = trace.getActiveSpan();
	if (span) {
		const spanContext = span.spanContext();
		if (spanContext.spanId && spanContext.spanId !== '0000000000000000') {
			return spanContext.spanId;
		}
	}
	return undefined;
}

/**
 * Create a new span that continues from an existing trace ID.
 * This is useful for linking traces across different services or agents.
 * 
 * @param traceId - The trace ID as a hexadecimal string (32 characters)
 * @param parentSpanId - Optional parent span ID as a hexadecimal string (16 characters).
 *   If provided, the new span will be a child of this span.
 * @param spanName - Name for the new span (default: "continued_span")
 * @returns A new span that continues the trace. Use it in a context manager or call end() manually.
 * 
 * @example
 * ```typescript
 * // In service A: get trace ID
 * const traceId = getTraceId();
 * const spanId = getSpanId();
 * 
 * // Send to service B (e.g., via HTTP, message queue, etc.)
 * // ...
 * 
 * // In service B: continue the trace
 * const span = createSpanFromTraceId(traceId, parentSpanId, "service_b_operation");
 * context.with(trace.setSpan(context.active(), span), () => {
 *   // Your code here
 *   span.end();
 * });
 * ```
 */
export function createSpanFromTraceId(
	traceId: string,
	parentSpanId?: string,
	spanName: string = "continued_span"
) {
	try {
		// Create a parent span context
		const parentSpanContext: SpanContext = {
			traceId: traceId,
			spanId: parentSpanId || '0000000000000000',
			traceFlags: TraceFlags.SAMPLED,
			isRemote: true,
		};
		
		// Create a context with this span context as the parent
		const parentContext = trace.setSpanContext(context.active(), parentSpanContext);
		
		// Start a new span in this context (it will be a child of the parent span)
		const span = tracer.startSpan(spanName, { root: false }, parentContext);
		
		// Set component tag if configured
		if (componentTag) {
			span.setAttribute('component', componentTag);
		}
		
		return span;
	} catch (error) {
		console.error('Error creating span from trace_id:', error);
		// Fallback: create a new span
		const span = tracer.startSpan(spanName);
		if (componentTag) {
			span.setAttribute('component', componentTag);
		}
		return span;
	}
}

/**
 * Inject the current trace context into a carrier (e.g., HTTP headers).
 * This allows you to pass trace context to another service.
 * 
 * @param carrier - Object to inject trace context into (e.g., HTTP headers object)
 * 
 * @example
 * ```typescript
 * import axios from 'axios';
 * 
 * const headers: Record<string, string> = {};
 * injectTraceContext(headers);
 * const response = await axios.get("http://other-service/api", { headers });
 * ```
 */
export function injectTraceContext(carrier: Record<string, string>): void {
	try {
		propagation.inject(context.active(), carrier);
	} catch (error) {
		console.warn('Error injecting trace context:', error);
	}
}

/**
 * Extract trace context from a carrier (e.g., HTTP headers).
 * Use this to continue a trace that was started in another service.
 * 
 * @param carrier - Object containing trace context (e.g., HTTP headers object)
 * @returns A context object that can be used with trace.setSpan() or tracer.startSpan()
 * 
 * @example
 * ```typescript
 * // Extract context from incoming request headers
 * const ctx = extractTraceContext(request.headers);
 * 
 * // Use the context to create a span
 * const span = tracer.startSpan("operation", {}, ctx);
 * context.with(trace.setSpan(ctx, span), () => {
 *   // Your code here
 *   span.end();
 * });
 * ```
 */
export function extractTraceContext(carrier: Record<string, string>) {
	try {
		return propagation.extract(context.active(), carrier);
	} catch (error) {
		console.warn('Error extracting trace context:', error);
		return context.active();
	}
}

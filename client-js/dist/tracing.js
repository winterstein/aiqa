"use strict";
/**
 * OpenTelemetry tracing setup and utilities. Initializes tracer provider on import.
 * Provides withTracingAsync and withTracing decorators to automatically trace function calls.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.exporter = exports.provider = void 0;
exports.flushSpans = flushSpans;
exports.shutdownTracing = shutdownTracing;
exports.withTracingAsync = withTracingAsync;
exports.withTracing = withTracing;
exports.setSpanAttribute = setSpanAttribute;
exports.getActiveSpan = getActiveSpan;
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const api_1 = require("@opentelemetry/api");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const resources_1 = require("@opentelemetry/resources");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const aiqa_exporter_1 = require("./aiqa-exporter");
// Load environment variables from .env file in client-js directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });
// Initialize OpenTelemetry with Elasticsearch exporter
const aiqaServerUrl = process.env.AIQA_SERVER_URL;
const exporter = new aiqa_exporter_1.AIQASpanExporter(aiqaServerUrl);
exports.exporter = exporter;
const provider = new sdk_trace_node_1.NodeTracerProvider({
    resource: new resources_1.Resource({
        [semantic_conventions_1.SEMRESATTRS_SERVICE_NAME]: 'example-service',
    }),
});
exports.provider = provider;
provider.addSpanProcessor(new sdk_trace_base_1.BatchSpanProcessor(exporter));
provider.register();
// Getting a tracer with the same name ('example-tracer') simply returns a tracer instance;
// it does NOT link spans automatically within the same trace.
// Each time you start a new root span (span without a parent), a new trace-id is generated.
// Spans only share a trace-id if they are started as children of the same trace context.
const tracer = api_1.trace.getTracer('example-tracer');
/**
 * Flush all pending spans to the server.
 * Flushes also happen automatically every few seconds. So you only need to call this function
 * if you want to flush immediately, e.g. before exiting a process.
 *
 * This flushes both the BatchSpanProcessor and the exporter buffer.
 *
 */
async function flushSpans() {
    await provider.forceFlush();
    await exporter.flush();
}
/**
 * Shutdown the tracer provider and exporter.
 * It is not necessary to call this function.
 */
async function shutdownTracing() {
    await provider.shutdown();
    await exporter.shutdown();
}
/**
 * Wrap async function to automatically create spans. Records input/output as span attributes.
 * Spans are automatically linked via OpenTelemetry context.
 */
function withTracingAsync(fn, options = {}) {
    const { name, ignoreInput, ignoreOutput, filterInput, filterOutput } = options;
    let fnName = name || fn.name || "_";
    if (fn._isTraced) {
        console.warn('Function ' + fnName + ' is already traced, skipping tracing again');
        return fn;
    }
    const tracedFn = async (...args) => {
        const span = tracer.startSpan(fnName);
        // Trace inputs using input. attributes
        let input = args;
        if (args.length === 0) {
            input = null;
        }
        else if (args.length === 1) {
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
            const curriedFn = () => fn(...args);
            const result = await api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), curriedFn);
            // Trace output
            let output = result;
            if (filterOutput) {
                output = filterOutput(output);
            }
            if (ignoreOutput && typeof output === 'object') {
                // TODO make a copy of output removing fields in ignoreOutput
            }
            span.setAttribute('output', output);
            return result;
        }
        catch (exception) {
            const error = exception instanceof Error ? exception : new Error(String(exception));
            span.recordException(error);
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: error.message });
            throw error; // Re-throw to maintain error propagation		  
        }
        finally {
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
function withTracing(fn, options = {}) {
    const { name, ignoreInput, ignoreOutput, filterInput, filterOutput } = options;
    let fnName = name || fn.name || "_";
    if (fn._isTraced) {
        console.warn('Function ' + fnName + ' is already traced, skipping tracing again');
        return fn;
    }
    const tracedFn = (...args) => {
        const span = tracer.startSpan(fnName);
        // Trace inputs using input. attributes
        let input = args;
        if (args.length === 0) {
            input = null;
        }
        else if (args.length === 1) {
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
            const curriedFn = () => fn(...args);
            const result = api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), curriedFn);
            // Trace output
            let output = result;
            if (filterOutput) {
                output = filterOutput(output);
            }
            if (ignoreOutput && typeof output === 'object') {
                // TODO make a copy of output removing fields in ignoreOutput
            }
            span.setAttribute('output', output);
            return result;
        }
        catch (exception) {
            const error = exception instanceof Error ? exception : new Error(String(exception));
            span.recordException(error);
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: error.message });
            throw error; // Re-throw to maintain error propagation		  
        }
        finally {
            span.end();
        }
    };
    tracedFn._isTraced = true; // avoid double wrapping
    console.log('Function ' + fnName + ' is now traced');
    return tracedFn;
}
function setSpanAttribute(attributeName, attributeValue) {
    let span = api_1.trace.getActiveSpan();
    if (span) {
        span.setAttribute(attributeName, attributeValue);
        return true;
    }
    return false; // no span found
}
function getActiveSpan() {
    return api_1.trace.getActiveSpan();
}

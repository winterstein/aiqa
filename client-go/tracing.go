package aiqa

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"os"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
)

var (
	tracerProvider *sdktrace.TracerProvider
	tracer         trace.Tracer
	exporter       *AIQAExporter
	samplingRate   float64 = 1.0 // Default: sample all traces
)

const (
	tracerName = "aiqa-tracer"
)

// traceIDSampler implements deterministic sampling based on trace-id
type traceIDSampler struct {
	rate float64
}

func (s *traceIDSampler) ShouldSample(params sdktrace.SamplingParameters) sdktrace.SamplingResult {
	if s.rate <= 0 {
		return sdktrace.SamplingResult{Decision: sdktrace.Drop}
	}
	if s.rate >= 1 {
		return sdktrace.SamplingResult{Decision: sdktrace.RecordAndSample}
	}
	
	// Use trace ID for deterministic sampling
	traceID := params.TraceID
	hash := fnv.New64a()
	hash.Write(traceID[:])
	hashValue := hash.Sum64()
	
	// Convert hash to a value in [0, 1)
	// hashValue is already a uint64, so normalize it by dividing by max uint64 (2^64 - 1)
	const maxUint64 = float64(^uint64(0))
	sampleValue := float64(hashValue) / maxUint64
	
	if sampleValue < s.rate {
		return sdktrace.SamplingResult{Decision: sdktrace.RecordAndSample}
	}
	return sdktrace.SamplingResult{Decision: sdktrace.Drop}
}

func (s *traceIDSampler) Description() string {
	return fmt.Sprintf("TraceIDSampler{rate=%.4f}", s.rate)
}

// TracingOptions contains options for tracing functions
type TracingOptions struct {
	Name        string
	IgnoreInput []string
	IgnoreOutput []string
	FilterInput  func(interface{}) interface{}
	FilterOutput func(interface{}) interface{}
}

// InitTracing initializes the OpenTelemetry tracer provider with AIQA exporter
// samplingRate: value between 0 and 1, where 0 = tracing is off, 1 = trace all
// If not provided, reads from AIQA_SAMPLING_RATE environment variable (default: 1.0)
func InitTracing(serverURL, apiKey string, samplingRateArg ...float64) error {
	if serverURL == "" {
		serverURL = os.Getenv("AIQA_SERVER_URL")
	}
	if apiKey == "" {
		apiKey = os.Getenv("AIQA_API_KEY")
	}
	
	// Set sampling rate
	if len(samplingRateArg) > 0 {
		samplingRate = samplingRateArg[0]
	} else {
		if envRate := os.Getenv("AIQA_SAMPLING_RATE"); envRate != "" {
			if rate, err := strconv.ParseFloat(envRate, 64); err == nil {
				samplingRate = rate
			}
		}
	}
	
	// Clamp sampling rate to [0, 1]
	if samplingRate < 0 {
		samplingRate = 0
	} else if samplingRate > 1 {
		samplingRate = 1
	}
	
	exporter = NewAIQAExporter(serverURL, apiKey, 5)
	
	res, err := resource.New(
		context.Background(),
		resource.WithAttributes(
			semconv.ServiceNameKey.String("example-service"),
		),
	)
	if err != nil {
		return fmt.Errorf("failed to create resource: %w", err)
	}
	
	// Create a batch span processor with the exporter
	bsp := sdktrace.NewBatchSpanProcessor(exporter)
	
	// Create custom sampler based on trace-id
	sampler := &traceIDSampler{rate: samplingRate}
	
	tracerProvider = sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(bsp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sampler),
	)
	
	otel.SetTracerProvider(tracerProvider)
	tracer = otel.Tracer(tracerName)
	
	return nil
}

// FlushSpans flushes all pending spans to the server
func FlushSpans(ctx context.Context) error {
	if tracerProvider != nil {
		if err := tracerProvider.ForceFlush(ctx); err != nil {
			return err
		}
	}
	if exporter != nil {
		return exporter.Flush(ctx)
	}
	return nil
}

// ShutdownTracing shuts down the tracer provider and exporter
func ShutdownTracing(ctx context.Context) error {
	if tracerProvider != nil {
		if err := tracerProvider.Shutdown(ctx); err != nil {
			return err
		}
	}
	if exporter != nil {
		return exporter.Shutdown(ctx)
	}
	return nil
}

// WithTracing wraps a function to automatically create spans
func WithTracing(fn interface{}, options ...TracingOptions) interface{} {
	opt := TracingOptions{}
	if len(options) > 0 {
		opt = options[0]
	}
	
	fnValue := reflect.ValueOf(fn)
	fnType := fnValue.Type()
	
	if fnType.Kind() != reflect.Func {
		panic("WithTracing: argument must be a function")
	}
	
	// Get function name
	fnName := opt.Name
	if fnName == "" {
		fnName = runtime.FuncForPC(fnValue.Pointer()).Name()
		if idx := strings.LastIndex(fnName, "."); idx >= 0 {
			fnName = fnName[idx+1:]
		}
	}
	
	// Check if already traced
	if fnValue.Kind() == reflect.Func {
		// Check for _isTraced field (not possible in Go, but we can track it differently)
		// For now, we'll just wrap it
	}
	
	// Determine if function is async (returns error or context)
	isAsync := false
	if fnType.NumOut() > 0 {
		lastOut := fnType.Out(fnType.NumOut() - 1)
		if lastOut.String() == "error" {
			isAsync = true
		}
	}
	
	if isAsync {
		return wrapAsyncFunction(fnValue, fnType, fnName, opt)
	}
	return wrapSyncFunction(fnValue, fnType, fnName, opt)
}

// wrapSyncFunction wraps a synchronous function
func wrapSyncFunction(fnValue reflect.Value, fnType reflect.Type, fnName string, opt TracingOptions) interface{} {
	wrapper := reflect.MakeFunc(fnType, func(args []reflect.Value) []reflect.Value {
		ctx := context.Background()
		if len(args) > 0 {
			if ctxVal := args[0]; ctxVal.Type().String() == "context.Context" {
				ctx = ctxVal.Interface().(context.Context)
			}
		}
		
		span := trace.SpanFromContext(ctx)
		if !span.IsRecording() {
			ctx, span = tracer.Start(ctx, fnName)
		} else {
			ctx, span = tracer.Start(ctx, fnName)
		}
		defer span.End()
		
		// Prepare input
		input := prepareInput(args, opt)
		if input != nil {
			span.SetAttributes(attribute.String("input", serializeValue(input)))
		}
		
		// Execute function
		results := fnValue.Call(args)
		
		// Handle results
		if len(results) > 0 {
			output := prepareOutput(results, opt)
			if output != nil {
				span.SetAttributes(attribute.String("output", serializeValue(output)))
			}
			
			// Check for error
			lastResult := results[len(results)-1]
			if lastResult.Type().String() == "error" && !lastResult.IsNil() {
				err := lastResult.Interface().(error)
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
			} else {
				span.SetStatus(codes.Ok, "")
			}
		} else {
			span.SetStatus(codes.Ok, "")
		}
		
		return results
	})
	
	return wrapper.Interface()
}

// wrapAsyncFunction wraps an asynchronous function (one that returns error)
func wrapAsyncFunction(fnValue reflect.Value, fnType reflect.Type, fnName string, opt TracingOptions) interface{} {
	wrapper := reflect.MakeFunc(fnType, func(args []reflect.Value) []reflect.Value {
		ctx := context.Background()
		if len(args) > 0 {
			if ctxVal := args[0]; ctxVal.Type().String() == "context.Context" {
				ctx = ctxVal.Interface().(context.Context)
			}
		}
		
		ctx, span := tracer.Start(ctx, fnName)
		defer span.End()
		
		// Prepare input
		input := prepareInput(args, opt)
		if input != nil {
			span.SetAttributes(attribute.String("input", serializeValue(input)))
		}
		
		// Execute function
		results := fnValue.Call(args)
		
		// Handle results
		if len(results) > 0 {
			output := prepareOutput(results, opt)
			if output != nil {
				span.SetAttributes(attribute.String("output", serializeValue(output)))
			}
			
			// Check for error (last return value)
			lastResult := results[len(results)-1]
			if lastResult.Type().String() == "error" {
				if !lastResult.IsNil() {
					err := lastResult.Interface().(error)
					span.RecordError(err)
					span.SetStatus(codes.Error, err.Error())
				} else {
					span.SetStatus(codes.Ok, "")
				}
			}
		}
		
		return results
	})
	
	return wrapper.Interface()
}

// prepareInput prepares function input for span attributes
func prepareInput(args []reflect.Value, opt TracingOptions) interface{} {
	if len(args) == 0 {
		return nil
	}
	
	// Filter out context if present
	filteredArgs := make([]reflect.Value, 0, len(args))
	for _, arg := range args {
		if arg.Type().String() != "context.Context" {
			filteredArgs = append(filteredArgs, arg)
		}
	}
	
	if len(filteredArgs) == 0 {
		return nil
	}
	
	if len(filteredArgs) == 1 {
		result := filteredArgs[0].Interface()
		if opt.FilterInput != nil {
			result = opt.FilterInput(result)
		}
		return result
	}
	
	// Multiple args - combine into map
	result := make(map[string]interface{})
	for i, arg := range filteredArgs {
		key := fmt.Sprintf("arg%d", i)
		result[key] = arg.Interface()
	}
	
	if opt.FilterInput != nil {
		result = opt.FilterInput(result).(map[string]interface{})
	}
	
	return result
}

// prepareOutput prepares function output for span attributes
func prepareOutput(results []reflect.Value, opt TracingOptions) interface{} {
	if len(results) == 0 {
		return nil
	}
	
	// Filter out error if present
	filteredResults := make([]reflect.Value, 0, len(results))
	for _, result := range results {
		if result.Type().String() != "error" {
			filteredResults = append(filteredResults, result)
		}
	}
	
	if len(filteredResults) == 0 {
		return nil
	}
	
	if len(filteredResults) == 1 {
		result := filteredResults[0].Interface()
		if opt.FilterOutput != nil {
			result = opt.FilterOutput(result)
		}
		return result
	}
	
	// Multiple results - combine into map
	result := make(map[string]interface{})
	for i, res := range filteredResults {
		key := fmt.Sprintf("result%d", i)
		result[key] = res.Interface()
	}
	
	if opt.FilterOutput != nil {
		result = opt.FilterOutput(result).(map[string]interface{})
	}
	
	return result
}

// serializeValue serializes a value to JSON string for span attributes
func serializeValue(value interface{}) string {
	// Try JSON serialization first
	jsonBytes, err := json.Marshal(value)
	if err != nil {
		// Fallback to string representation
		return fmt.Sprintf("%v", value)
	}
	return string(jsonBytes)
}

// SetSpanAttribute sets an attribute on the active span
func SetSpanAttribute(ctx context.Context, attributeName string, attributeValue interface{}) bool {
	span := trace.SpanFromContext(ctx)
	if span.IsRecording() {
		span.SetAttributes(attribute.String(attributeName, serializeValue(attributeValue)))
		return true
	}
	return false
}

// GetActiveSpan returns the active span from context
func GetActiveSpan(ctx context.Context) trace.Span {
	return trace.SpanFromContext(ctx)
}

// SetConversationId sets the conversation.id attribute on the active span.
// This allows you to group multiple traces together that are part of the same conversation.
//
// conversationId: A unique identifier for the conversation (e.g., user session ID, chat ID, etc.)
// Returns: True if conversation.id was set, False if no active span found
func SetConversationId(ctx context.Context, conversationId string) bool {
	return SetSpanAttribute(ctx, "conversation.id", conversationId)
}

// GetTraceId gets the current trace ID as a hexadecimal string (32 characters).
// Returns: The trace ID as a hex string, or empty string if no active span exists.
func GetTraceId(ctx context.Context) string {
	span := trace.SpanFromContext(ctx)
	if span.IsRecording() {
		spanContext := span.SpanContext()
		traceID := spanContext.TraceID()
		if traceID.IsValid() {
			return traceID.String()
		}
	}
	return ""
}

// GetSpanId gets the current span ID as a hexadecimal string (16 characters).
// Returns: The span ID as a hex string, or empty string if no active span exists.
func GetSpanId(ctx context.Context) string {
	span := trace.SpanFromContext(ctx)
	if span.IsRecording() {
		spanContext := span.SpanContext()
		spanID := spanContext.SpanID()
		if spanID.IsValid() {
			return spanID.String()
		}
	}
	return ""
}

// CreateSpanFromTraceId creates a new span that continues from an existing trace ID.
// This is useful for linking traces across different services or agents.
//
// traceId: The trace ID as a hexadecimal string (32 characters)
// parentSpanId: Optional parent span ID as a hexadecimal string (16 characters).
//   If provided, the new span will be a child of this span.
// spanName: Name for the new span (default: "continued_span")
// Returns: A context with the new span and the span itself. Use it with defer span.End().
func CreateSpanFromTraceId(ctx context.Context, traceId string, parentSpanId string, spanName string) (context.Context, trace.Span) {
	if spanName == "" {
		spanName = "continued_span"
	}

	// Parse trace ID
	traceID, err := trace.TraceIDFromHex(traceId)
	if err != nil {
		// Fallback: create a new span
		return tracer.Start(ctx, spanName)
	}

	// Parse parent span ID if provided
	var spanID trace.SpanID
	if parentSpanId != "" {
		spanID, err = trace.SpanIDFromHex(parentSpanId)
		if err != nil {
			// If parent span ID is invalid, use zero span ID
			spanID = trace.SpanID{}
		}
	}

	// Create a span context
	spanContext := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})

	// Create a context with this span context as the parent
	ctx = trace.ContextWithRemoteSpanContext(ctx, spanContext)

	// Start a new span in this context (it will be a child of the parent span)
	return tracer.Start(ctx, spanName)
}

// InjectTraceContext injects the current trace context into a carrier (e.g., HTTP headers).
// This allows you to pass trace context to another service.
//
// carrier: Map to inject trace context into (e.g., HTTP headers map)
func InjectTraceContext(ctx context.Context, carrier map[string]string) {
	prop := otel.GetTextMapPropagator()
	prop.Inject(ctx, propagation.MapCarrier(carrier))
}

// ExtractTraceContext extracts trace context from a carrier (e.g., HTTP headers).
// Use this to continue a trace that was started in another service.
//
// carrier: Map containing trace context (e.g., HTTP headers map)
// Returns: A context object that can be used with tracer.Start()
func ExtractTraceContext(ctx context.Context, carrier map[string]string) context.Context {
	prop := otel.GetTextMapPropagator()
	return prop.Extract(ctx, propagation.MapCarrier(carrier))
}


package aiqa

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
)

// SerializableSpan represents a span in a format that can be sent to the AIQA server
type SerializableSpan struct {
	Name           string                 `json:"name"`
	Kind           int                    `json:"kind"`
	ParentSpanID   string                 `json:"parentSpanId,omitempty"`
	StartTime      [2]int64               `json:"startTime"`
	EndTime        [2]int64               `json:"endTime"`
	Status         SpanStatus             `json:"status"`
	Attributes     map[string]interface{} `json:"attributes"`
	Links          []SpanLink             `json:"links"`
	Events         []SpanEvent            `json:"events"`
	Resource       map[string]interface{} `json:"resource"`
	TraceID        string                 `json:"traceId"`
	SpanID         string                 `json:"spanId"`
	TraceFlags     byte                   `json:"traceFlags"`
	Duration       [2]int64               `json:"duration"`
	Ended          bool                   `json:"ended"`
	InstrumentationLibrary InstrumentationLibrary `json:"instrumentationLibrary"`
}

type SpanStatus struct {
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
}

type SpanLink struct {
	Context   SpanContext            `json:"context"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

type SpanContext struct {
	TraceID string `json:"traceId"`
	SpanID  string `json:"spanId"`
}

type SpanEvent struct {
	Name       string                 `json:"name"`
	Time       [2]int64               `json:"time"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

type InstrumentationLibrary struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
}

// AIQAExporter exports spans to the AIQA server API.
// Buffers spans and auto-flushes every flushIntervalSeconds.
// Call Shutdown() before process exit to flush remaining spans.
type AIQAExporter struct {
	serverURL         string
	apiKey            string
	flushInterval     time.Duration
	buffer            []SerializableSpan
	bufferMutex       sync.Mutex
	flushMutex        sync.Mutex
	shutdownRequested bool
	flushTimer        *time.Timer
	client            *http.Client
}

// NewAIQAExporter creates a new AIQA exporter
func NewAIQAExporter(serverURL, apiKey string, flushIntervalSeconds int) *AIQAExporter {
	if serverURL == "" {
		serverURL = os.Getenv("AIQA_SERVER_URL")
	}
	if apiKey == "" {
		apiKey = os.Getenv("AIQA_API_KEY")
	}
	
	// Remove trailing slash
	serverURL = strings.TrimSuffix(serverURL, "/")
	
	exporter := &AIQAExporter{
		serverURL:     serverURL,
		apiKey:        apiKey,
		flushInterval: time.Duration(flushIntervalSeconds) * time.Second,
		buffer:        make([]SerializableSpan, 0),
		client:        &http.Client{Timeout: 30 * time.Second},
	}
	
	exporter.startAutoFlush()
	return exporter
}

// ExportSpans exports spans to the AIQA server (implements trace.SpanExporter)
func (e *AIQAExporter) ExportSpans(ctx context.Context, spans []trace.ReadOnlySpan) error {
	if len(spans) == 0 {
		return nil
	}
	
	// Add spans to buffer (thread-safe)
	e.addToBuffer(spans)
	return nil
}

// addToBuffer adds spans to the buffer in a thread-safe manner
func (e *AIQAExporter) addToBuffer(spans []trace.ReadOnlySpan) {
	e.bufferMutex.Lock()
	defer e.bufferMutex.Unlock()
	
	for _, span := range spans {
		serialized := e.serializeSpan(span)
		e.buffer = append(e.buffer, serialized)
	}
}

// serializeSpan converts a ReadOnlySpan to a SerializableSpan
func (e *AIQAExporter) serializeSpan(span trace.ReadOnlySpan) SerializableSpan {
	spanContext := span.SpanContext()
	
	// Convert start/end times to [seconds, nanoseconds] format
	startTime := span.StartTime()
	endTime := span.EndTime()
	
	// Convert to Unix timestamp with nanoseconds
	startUnix := startTime.Unix()
	startNano := int64(startTime.Nanosecond())
	endUnix := endTime.Unix()
	endNano := int64(endTime.Nanosecond())
	
	attributes := make(map[string]interface{})
	for _, kv := range span.Attributes() {
		key := string(kv.Key)
		value := kv.Value.AsInterface()
		attributes[key] = applyDataFilters(key, value)
	}
	
	resourceAttrs := make(map[string]interface{})
	span.Resource().Attributes().Range(func(kv attribute.KeyValue) bool {
		key := string(kv.Key)
		value := kv.Value.AsInterface()
		resourceAttrs[key] = applyDataFilters(key, value)
		return true
	})
	
	links := make([]SpanLink, 0, len(span.Links()))
	for _, link := range span.Links() {
		linkAttrs := make(map[string]interface{})
		for _, kv := range link.Attributes {
			key := string(kv.Key)
			value := kv.Value.AsInterface()
			linkAttrs[key] = applyDataFilters(key, value)
		}
		links = append(links, SpanLink{
			Context: SpanContext{
				TraceID: link.SpanContext.TraceID().String(),
				SpanID:  link.SpanContext.SpanID().String(),
			},
			Attributes: linkAttrs,
		})
	}
	
	events := make([]SpanEvent, 0, len(span.Events()))
	for _, event := range span.Events() {
		eventAttrs := make(map[string]interface{})
		for _, kv := range event.Attributes {
			key := string(kv.Key)
			value := kv.Value.AsInterface()
			eventAttrs[key] = applyDataFilters(key, value)
		}
		eventUnix := event.Time.Unix()
		eventNano := int64(event.Time.Nanosecond())
		events = append(events, SpanEvent{
			Name:       event.Name,
			Time:       [2]int64{eventUnix, eventNano},
			Attributes: eventAttrs,
		})
	}
	
	var parentSpanID string
	if span.Parent().SpanID().IsValid() {
		parentSpanID = span.Parent().SpanID().String()
	}
	
	return SerializableSpan{
		Name:     span.Name(),
		Kind:     int(span.SpanKind()),
		ParentSpanID: parentSpanID,
		StartTime: [2]int64{startUnix, startNano},
		EndTime:   [2]int64{endUnix, endNano},
		Status: SpanStatus{
			Code:    int(span.Status().Code),
			Message: span.Status().Description,
		},
		Attributes: attributes,
		Links:      links,
		Events:     events,
		Resource:   resourceAttrs,
		TraceID:    spanContext.TraceID().String(),
		SpanID:     spanContext.SpanID().String(),
		TraceFlags: byte(spanContext.TraceFlags()),
		Duration:   [2]int64{endUnix - startUnix, endNano - startNano},
		Ended:      span.EndTime().After(span.StartTime()),
		InstrumentationLibrary: InstrumentationLibrary{
			Name:    span.InstrumentationLibrary().Name,
			Version: span.InstrumentationLibrary().Version,
		},
	}
}

// Flush flushes buffered spans to the server. Thread-safe.
func (e *AIQAExporter) Flush(ctx context.Context) error {
	e.flushMutex.Lock()
	defer e.flushMutex.Unlock()
	
	e.bufferMutex.Lock()
	spansToFlush := make([]SerializableSpan, len(e.buffer))
	copy(spansToFlush, e.buffer)
	e.buffer = e.buffer[:0]
	e.bufferMutex.Unlock()
	
	if len(spansToFlush) == 0 {
		return nil
	}
	
	if e.serverURL == "" {
		fmt.Printf("AIQA: Skipping flush: AIQA_SERVER_URL is not set. %d span(s) will not be sent.\n", len(spansToFlush))
		return nil
	}
	
	return e.sendSpans(ctx, spansToFlush)
}

// sendSpans sends spans to the server API
func (e *AIQAExporter) sendSpans(ctx context.Context, spans []SerializableSpan) error {
	if e.serverURL == "" {
		return fmt.Errorf("AIQA_SERVER_URL is not set. Cannot send spans to server")
	}
	
	jsonData, err := json.Marshal(spans)
	if err != nil {
		return fmt.Errorf("failed to marshal spans: %w", err)
	}
	
	url := fmt.Sprintf("%s/span", e.serverURL)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Content-Type", "application/json")
	if e.apiKey != "" {
		req.Header.Set("Authorization", fmt.Sprintf("ApiKey %s", e.apiKey))
	}
	
	resp, err := e.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send spans: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to send spans: %d %s - %s", resp.StatusCode, resp.Status, string(body))
	}
	
	return nil
}

// startAutoFlush starts the auto-flush timer
func (e *AIQAExporter) startAutoFlush() {
	e.flushTimer = time.AfterFunc(e.flushInterval, func() {
		if !e.shutdownRequested {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := e.Flush(ctx); err != nil {
				fmt.Printf("AIQA: Error in auto-flush: %v\n", err)
			}
			if !e.shutdownRequested {
				e.startAutoFlush()
			}
		}
	})
}

// Shutdown shuts down the exporter, flushing any remaining spans
func (e *AIQAExporter) Shutdown(ctx context.Context) error {
	e.shutdownRequested = true
	
	if e.flushTimer != nil {
		e.flushTimer.Stop()
	}
	
	return e.Flush(ctx)
}


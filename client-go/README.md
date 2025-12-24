# AIQA Go Client

OpenTelemetry-based client for AIQA that logs traces to the server.

## Setup

1. Install dependencies:
```bash
go mod download
```

2. Set environment variables (or pass them to `InitTracing`):
```bash
export AIQA_SERVER_URL=http://localhost:3000
export AIQA_API_KEY=your-api-key
export AIQA_COMPONENT_TAG=mynamespace.mysystem  # Optional: component tag for all spans
```

## Usage

### Basic Example

```go
package main

import (
    "context"
    "time"
    "github.com/aiqa/client-go"
)

func main() {
    // Initialize tracing
    err := aiqa.InitTracing("", "")
    if err != nil {
        panic(err)
    }
    defer func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        aiqa.ShutdownTracing(ctx)
    }()

    // Wrap a function with tracing
    multiply := func(x, y int) int {
        return x * y
    }
    tracedMultiply := aiqa.WithTracing(multiply).(func(int, int) int)
    
    result := tracedMultiply(5, 3)
    fmt.Println(result)
}
```

### With Error Handling

```go
divide := func(x, y float64) (float64, error) {
    if y == 0 {
        return 0, fmt.Errorf("division by zero")
    }
    return x / y, nil
}
tracedDivide := aiqa.WithTracing(divide).(func(float64, float64) (float64, error))
result, err := tracedDivide(10, 2)
```

### With Context

```go
processData := func(ctx context.Context, data string) (string, error) {
    // Your function logic here
    return fmt.Sprintf("Processed: %s", data), nil
}
tracedProcess := aiqa.WithTracing(processData).(func(context.Context, string) (string, error))
result, err := tracedProcess(context.Background(), "test")
```

### Custom Span Name

```go
options := aiqa.TracingOptions{
    Name: "custom-function-name",
}
tracedFn := aiqa.WithTracing(myFunction, options)
```

### Setting Span Attributes

```go
ctx := context.Background()
aiqa.SetSpanAttribute(ctx, "custom.attribute", "value")
```

### Setting Component Tag

The component tag allows you to identify which component/system generated the spans. It can be set programmatically or via the `AIQA_COMPONENT_TAG` environment variable:

```go
// Set component tag programmatically
aiqa.SetComponentTag("mynamespace.mysystem")

// Or set via environment variable:
// export AIQA_COMPONENT_TAG="mynamespace.mysystem"
```

## Configuration

The client can be configured via environment variables or by passing parameters to `InitTracing`:

- `AIQA_SERVER_URL`: URL of the AIQA server (default: empty, must be set)
- `AIQA_API_KEY`: API key for authentication (default: empty)
- `AIQA_COMPONENT_TAG`: Component tag to add to all spans (e.g., "mynamespace.mysystem"). Optional.
- `AIQA_SAMPLING_RATE`: Sampling rate between 0 and 1 (default: 1.0 = sample all). Optional.

## Flushing Spans

Spans are automatically flushed every 5 seconds. To flush immediately:

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
aiqa.FlushSpans(ctx)
```

## Shutting Down

Always call `ShutdownTracing` before your program exits to ensure all spans are sent:

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
aiqa.ShutdownTracing(ctx)
```

## Running the Example

```bash
go run example.go
```

Make sure `AIQA_SERVER_URL` and `AIQA_API_KEY` are set in your environment.


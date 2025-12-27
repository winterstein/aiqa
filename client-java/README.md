# AIQA Java Client

OpenTelemetry-based Java client for tracing functions and sending traces to the AIQA server.

## Installation

### From GitHub Packages (Recommended)

1. **Add repository** to your `pom.xml`:

```xml
<repositories>
    <repository>
        <id>github</id>
        <url>https://maven.pkg.github.com/winterstein/aiqa</url>
    </repository>
</repositories>
```

2. **Configure authentication** in `~/.m2/settings.xml`:

```xml
<settings>
    <servers>
        <server>
            <id>github</id>
            <username>YOUR_GITHUB_USERNAME</username>
            <password>YOUR_GITHUB_TOKEN</password>
        </server>
    </servers>
</settings>
```

Create a GitHub Personal Access Token with `read:packages` permission at https://github.com/settings/tokens

3. **Add dependency** to your `pom.xml`:

```xml
<dependency>
    <groupId>dev.aiqa</groupId>
    <artifactId>aiqa-client</artifactId>
    <version>0.1.0</version>
</dependency>
```

### From Maven Central (when published)

Add to your `pom.xml`:

```xml
<dependency>
    <groupId>dev.aiqa</groupId>
    <artifactId>aiqa-client</artifactId>
    <version>0.1.0</version>
</dependency>
```

### From Source

```bash
cd client-java
mvn clean install
```

Then add to your `pom.xml`:

```xml
<dependency>
    <groupId>dev.aiqa</groupId>
    <artifactId>aiqa-client</artifactId>
    <version>0.1.0</version>
</dependency>
```

## Setup

Set the following environment variables:

```bash
export AIQA_SERVER_URL="http://localhost:3000"
export AIQA_API_KEY="your-api-key"
```

Optional environment variables:

- `AIQA_SAMPLING_RATE`: Sampling rate (0.0 to 1.0, default: 1.0)
- `AIQA_COMPONENT_TAG`: Component tag to add to all spans

## Usage

### Basic Tracing

```java
import dev.aiqa.tracing.Tracing;
import java.util.function.Function;

Function<String, String> tracedFunction = Tracing.withTracing("my_function", input -> {
    return "Processed: " + input;
});

String result = tracedFunction.apply("test");
```

### Custom Span Attributes

```java
import dev.aiqa.tracing.Tracing;

// Set conversation ID to group traces
Tracing.setConversationId("user_123_session_456");

// Set token usage
Tracing.setTokenUsage(100, 50, 150);

// Set provider and model
Tracing.setProviderAndModel("openai", "gpt-4");

// Set custom attribute
Tracing.setSpanAttribute("custom.attribute", "value");
```

### Experiment Runner

```java
import dev.aiqa.ExperimentRunner;
import dev.aiqa.types.Example;
import java.util.*;

// Create runner
ExperimentRunner runner = new ExperimentRunner(
        "dataset-id",
        "http://localhost:3000",
        "your-api-key",
        "your-org-id"
);

// Create experiment
Map<String, Object> experimentSetup = new HashMap<>();
experimentSetup.put("name", "My Experiment");
Map<String, Object> parameters = new HashMap<>();
parameters.put("model", "gpt-4");
experimentSetup.put("parameters", parameters);
runner.createExperiment(experimentSetup);

// Run experiment on all examples
runner.run(
        input -> {
            // Your code here - process the input
            return "output";
        },
        (output, example) -> {
            // Your scoring logic here
            Map<String, Number> scores = new HashMap<>();
            scores.put("accuracy", 0.95);
            return scores;
        }
);

// Get summary results
Map<String, Object> summary = runner.getSummaryResults();
```

### Running Individual Examples

```java
// Get examples
List<Example> examples = runner.getExampleInputs(100);

// Run on a single example
List<Map<String, Object>> results = runner.runExample(
        examples.get(0),
        input -> {
            // Your code here
            return "output";
        },
        (output, example) -> {
            // Scoring logic
            Map<String, Number> scores = new HashMap<>();
            scores.put("score", 0.9);
            return scores;
        }
);
```

### Flushing and Shutdown

```java
// Flush pending spans immediately
Tracing.flush();

// Shutdown tracer (call before process exit)
Tracing.shutdown();
```

## Features

- Automatic tracing of function calls
- Records function inputs and outputs as span attributes
- Automatic error tracking and exception recording
- Thread-safe span buffering and auto-flushing
- OpenTelemetry context propagation for nested spans
- Trace ID propagation utilities for distributed tracing
- Experiment runner for running and scoring experiments

## Requirements

- Java 11 or higher
- Maven 3.6 or higher (for building)

## Example

See `src/main/java/dev/aiqa/Example.java` for a complete working example.


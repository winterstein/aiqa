package dev.aiqa;

import dev.aiqa.tracing.Tracing;
import io.opentelemetry.api.trace.Span;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;

/**
 * Example usage of the AIQA Java client
 */
public class Example {
    public static void main(String[] args) throws Exception {
        // Initialize tracing (reads from environment variables)
        // Set AIQA_SERVER_URL and AIQA_API_KEY environment variables
        
        // Example 1: Basic tracing
        Function<String, String> tracedFunction = Tracing.withTracing("my_function", input -> {
            return "Processed: " + input;
        });
        
        String result = tracedFunction.apply("test");
        System.out.println("Result: " + result);
        
        // Example 2: Set conversation ID
        Span span = Tracing.getActiveSpan();
        if (span != null) {
            Tracing.setConversationId("user_123_session_456");
        }
        
        // Example 3: Set token usage
        Tracing.setTokenUsage(100, 50, 150);
        
        // Example 4: Set provider and model
        Tracing.setProviderAndModel("openai", "gpt-4");
        
        // Example 5: Using ExperimentRunner
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
        
        // Run experiment
        runner.run(
                input -> {
                    // Your code here
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
        System.out.println("Summary: " + summary);
        
        // Flush and shutdown
        Tracing.flush();
        Tracing.shutdown();
    }
}


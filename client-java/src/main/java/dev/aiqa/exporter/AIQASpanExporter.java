package dev.aiqa.exporter;

import io.opentelemetry.sdk.common.CompletableResultCode;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SpanExporter;
import okhttp3.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ValueNode;

/**
 * OpenTelemetry span exporter that sends spans to the AIQA server API.
 * Buffers spans and flushes them periodically or on shutdown. Thread-safe.
 */
public class AIQASpanExporter implements SpanExporter {
    private static final Logger logger = LoggerFactory.getLogger(AIQASpanExporter.class);
    
    private final String serverUrl;
    private final String apiKey;
    private final long flushIntervalMs;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final BlockingQueue<SpanData> buffer;
    private final AtomicBoolean shutdownRequested = new AtomicBoolean(false);
    private ScheduledExecutorService scheduler;
    private Future<?> flushTask;

    public AIQASpanExporter(String serverUrl, String apiKey, long flushIntervalSeconds) {
        this.serverUrl = serverUrl != null ? serverUrl.replaceAll("/$", "") : null;
        this.apiKey = apiKey != null ? apiKey : "";
        this.flushIntervalMs = flushIntervalSeconds * 1000;
        this.httpClient = new OkHttpClient();
        this.objectMapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        this.buffer = new LinkedBlockingQueue<>();
        startAutoFlush();
    }

    @Override
    public CompletableResultCode export(Collection<SpanData> spans) {
        if (spans.isEmpty()) {
            return CompletableResultCode.ofSuccess();
        }

        // Add spans to buffer (non-blocking)
        buffer.addAll(spans);
        
        // Return success immediately to avoid blocking
        return CompletableResultCode.ofSuccess();
    }

    @Override
    public CompletableResultCode flush() {
        List<SpanData> spansToFlush = new ArrayList<>();
        buffer.drainTo(spansToFlush);

        if (spansToFlush.isEmpty()) {
            return CompletableResultCode.ofSuccess();
        }

        if (serverUrl == null || serverUrl.isEmpty()) {
            logger.warn("AIQA: Skipping flush: AIQA_SERVER_URL is not set. {} span(s) will not be sent.", 
                    spansToFlush.size());
            return CompletableResultCode.ofSuccess();
        }

        try {
            sendSpans(spansToFlush);
            return CompletableResultCode.ofSuccess();
        } catch (Exception e) {
            logger.error("AIQA: Error flushing spans to server", e);
            if (shutdownRequested.get()) {
                return CompletableResultCode.ofFailure();
            }
            return CompletableResultCode.ofSuccess(); // Don't fail on auto-flush
        }
    }

    /**
     * Get enabled filters from AIQA_DATA_FILTERS env var
     */
    private Set<String> getEnabledFilters() {
        String filtersEnv = System.getenv("AIQA_DATA_FILTERS");
        if (filtersEnv == null || filtersEnv.isEmpty()) {
            filtersEnv = "RemovePasswords, RemoveJWT";
        }
        Set<String> enabled = new HashSet<>();
        for (String f : filtersEnv.split(",")) {
            String trimmed = f.trim();
            if (!trimmed.isEmpty()) {
                enabled.add(trimmed);
            }
        }
        return enabled;
    }

    /**
     * Check if a value looks like a JWT token
     */
    private boolean isJWTToken(Object value) {
        if (!(value instanceof String)) {
            return false;
        }
        String str = (String) value;
        // JWT tokens have format: header.payload.signature (3 parts separated by dots)
        // They typically start with "eyJ" (base64 encoded '{"')
        String[] parts = str.split("\\.");
        return parts.length == 3 && str.startsWith("eyJ") && 
               parts[0].length() > 0 && parts[1].length() > 0 && parts[2].length() > 0;
    }

    /**
     * Check if a value looks like an API key
     */
    private boolean isAPIKey(Object value) {
        if (!(value instanceof String)) {
            return false;
        }
        String str = ((String) value).trim();
        // Common API key prefixes
        String[] apiKeyPrefixes = {"sk-", "pk-", "AKIA", "ghp_", "gho_", "ghu_", "ghs_", "ghr_"};
        for (String prefix : apiKeyPrefixes) {
            if (str.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Apply data filters to a key-value pair
     */
    private Object applyDataFilters(String key, Object value) {
        // Don't filter falsy values
        if (value == null) {
            return value;
        }
        
        // Check if value is falsy (empty string, zero, false)
        if (value instanceof String && ((String) value).isEmpty()) {
            return value;
        }
        if (value instanceof Number && ((Number) value).doubleValue() == 0.0) {
            return value;
        }
        if (value instanceof Boolean && !((Boolean) value)) {
            return value;
        }
        
        Set<String> enabledFilters = getEnabledFilters();
        String keyLower = key.toLowerCase();
        
        // RemovePasswords filter: if key contains "password", replace value with "****"
        if (enabledFilters.contains("RemovePasswords") && keyLower.contains("password")) {
            return "****";
        }
        
        // RemoveJWT filter: if value looks like a JWT token, replace with "****"
        if (enabledFilters.contains("RemoveJWT") && isJWTToken(value)) {
            return "****";
        }
        
        // RemoveAuthHeaders filter: if key is "authorization" (case-insensitive), replace value with "****"
        if (enabledFilters.contains("RemoveAuthHeaders") && keyLower.equals("authorization")) {
            return "****";
        }
        
        // RemoveAPIKeys filter: if key contains API key patterns or value looks like an API key
        if (enabledFilters.contains("RemoveAPIKeys")) {
            // Check key patterns
            String[] apiKeyKeyPatterns = {"api_key", "apikey", "api-key", "apikey"};
            for (String pattern : apiKeyKeyPatterns) {
                if (keyLower.contains(pattern)) {
                    return "****";
                }
            }
            // Check value patterns
            if (isAPIKey(value)) {
                return "****";
            }
        }
        
        return value;
    }

    /**
     * Recursively apply data filters to a JSON node
     */
    private JsonNode filterDataRecursive(JsonNode node) {
        if (node == null || node.isNull()) {
            return node;
        }
        
        if (node.isObject()) {
            ObjectNode objectNode = objectMapper.createObjectNode();
            node.fields().forEachRemaining(entry -> {
                String key = entry.getKey();
                JsonNode value = entry.getValue();
                
                // Apply filters based on the key and value
                if (value.isTextual()) {
                    String strValue = value.asText();
                    Object filteredValue = applyDataFilters(key, strValue);
                    if (filteredValue instanceof String && !filteredValue.equals(strValue)) {
                        // Value was filtered, use the filtered string
                        objectNode.put(key, (String) filteredValue);
                    } else {
                        // Value not filtered, recursively process nested structures
                        objectNode.set(key, filterDataRecursive(value));
                    }
                } else {
                    // For non-string values, recursively filter
                    objectNode.set(key, filterDataRecursive(value));
                }
            });
            return objectNode;
        }
        
        if (node.isArray()) {
            ArrayNode arrayNode = objectMapper.createArrayNode();
            for (JsonNode item : node) {
                arrayNode.add(filterDataRecursive(item));
            }
            return arrayNode;
        }
        
        // For primitive string values, apply filters
        if (node.isTextual()) {
            String str = node.asText();
            Object filtered = applyDataFilters("", str);
            if (filtered instanceof String && !filtered.equals(str)) {
                return objectMapper.valueToTree(filtered);
            }
        }
        
        return node;
    }

    private void sendSpans(List<SpanData> spans) throws IOException {
        // Convert spans to JSON, apply filters, then send
        String json = objectMapper.writeValueAsString(spans);
        JsonNode rootNode = objectMapper.readTree(json);
        JsonNode filteredNode = filterDataRecursive(rootNode);
        String filteredJson = objectMapper.writeValueAsString(filteredNode);
        
        RequestBody body = RequestBody.create(
                filteredJson, 
                MediaType.parse("application/json")
        );
        
        Request request = new Request.Builder()
                .url(serverUrl + "/span")
                .post(body)
                .addHeader("Content-Type", "application/json")
                .addHeader("Authorization", "ApiKey " + apiKey)
                .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "Unknown error";
                throw new IOException("Failed to send spans: " + response.code() + " " + 
                        response.message() + " - " + errorBody);
            }
        }
    }

    private void startAutoFlush() {
        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "aiqa-exporter-flush");
            t.setDaemon(true);
            return t;
        });
        
        flushTask = scheduler.scheduleAtFixedRate(
                () -> {
                    if (!shutdownRequested.get()) {
                        flush();
                    }
                },
                flushIntervalMs,
                flushIntervalMs,
                TimeUnit.MILLISECONDS
        );
    }

    @Override
    public CompletableResultCode shutdown() {
        shutdownRequested.set(true);
        
        if (flushTask != null) {
            flushTask.cancel(false);
        }
        
        if (scheduler != null) {
            scheduler.shutdown();
            try {
                if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                    scheduler.shutdownNow();
                }
            } catch (InterruptedException e) {
                scheduler.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }

        // Flush any remaining spans
        return flush();
    }
}


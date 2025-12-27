package dev.aiqa.types;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public class Dataset {
    private String id;
    private String organisation;
    private String name;
    private String description;
    private List<String> tags;
    
    @JsonProperty("input_schema")
    private Map<String, Object> inputSchema;
    
    @JsonProperty("output_schema")
    private Map<String, Object> outputSchema;
    
    private List<Metric> metrics;
    private Instant created;
    private Instant updated;

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getOrganisation() { return organisation; }
    public void setOrganisation(String organisation) { this.organisation = organisation; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public List<String> getTags() { return tags; }
    public void setTags(List<String> tags) { this.tags = tags; }

    public Map<String, Object> getInputSchema() { return inputSchema; }
    public void setInputSchema(Map<String, Object> inputSchema) { this.inputSchema = inputSchema; }

    public Map<String, Object> getOutputSchema() { return outputSchema; }
    public void setOutputSchema(Map<String, Object> outputSchema) { this.outputSchema = outputSchema; }

    public List<Metric> getMetrics() { return metrics; }
    public void setMetrics(List<Metric> metrics) { this.metrics = metrics; }

    public Instant getCreated() { return created; }
    public void setCreated(Instant created) { this.created = created; }

    public Instant getUpdated() { return updated; }
    public void setUpdated(Instant updated) { this.updated = updated; }
}


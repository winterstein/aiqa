package dev.aiqa.types;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public class Example {
    private String id;
    
    @JsonProperty("traceId")
    private String traceId;
    
    private String dataset;
    private String organisation;
    private List<Map<String, Object>> spans;
    private Object input;
    private Outputs outputs;
    private Instant created;
    private Instant updated;
    private List<Metric> metrics;

    public static class Outputs {
        private Object good;
        private Object bad;

        public Object getGood() { return good; }
        public void setGood(Object good) { this.good = good; }

        public Object getBad() { return bad; }
        public void setBad(Object bad) { this.bad = bad; }
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getTraceId() { return traceId; }
    public void setTraceId(String traceId) { this.traceId = traceId; }

    public String getDataset() { return dataset; }
    public void setDataset(String dataset) { this.dataset = dataset; }

    public String getOrganisation() { return organisation; }
    public void setOrganisation(String organisation) { this.organisation = organisation; }

    public List<Map<String, Object>> getSpans() { return spans; }
    public void setSpans(List<Map<String, Object>> spans) { this.spans = spans; }

    public Object getInput() { return input; }
    public void setInput(Object input) { this.input = input; }

    public Outputs getOutputs() { return outputs; }
    public void setOutputs(Outputs outputs) { this.outputs = outputs; }

    public Instant getCreated() { return created; }
    public void setCreated(Instant created) { this.created = created; }

    public Instant getUpdated() { return updated; }
    public void setUpdated(Instant updated) { this.updated = updated; }

    public List<Metric> getMetrics() { return metrics; }
    public void setMetrics(List<Metric> metrics) { this.metrics = metrics; }
}


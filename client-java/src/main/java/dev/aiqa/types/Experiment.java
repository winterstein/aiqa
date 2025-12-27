package dev.aiqa.types;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public class Experiment {
    private String id;
    private String dataset;
    private String organisation;
    private String name;
    private Map<String, Object> parameters;
    
    @JsonProperty("comparison_parameters")
    private List<Map<String, Object>> comparisonParameters;
    
    @JsonProperty("summary_results")
    private Map<String, Object> summaryResults;
    
    private Instant created;
    private Instant updated;
    private List<Result> results;

    public static class Result {
        @JsonProperty("exampleId")
        private String exampleId;
        private Map<String, Number> scores;
        private Map<String, String> errors;

        public String getExampleId() { return exampleId; }
        public void setExampleId(String exampleId) { this.exampleId = exampleId; }

        public Map<String, Number> getScores() { return scores; }
        public void setScores(Map<String, Number> scores) { this.scores = scores; }

        public Map<String, String> getErrors() { return errors; }
        public void setErrors(Map<String, String> errors) { this.errors = errors; }
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getDataset() { return dataset; }
    public void setDataset(String dataset) { this.dataset = dataset; }

    public String getOrganisation() { return organisation; }
    public void setOrganisation(String organisation) { this.organisation = organisation; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public Map<String, Object> getParameters() { return parameters; }
    public void setParameters(Map<String, Object> parameters) { this.parameters = parameters; }

    public List<Map<String, Object>> getComparisonParameters() { return comparisonParameters; }
    public void setComparisonParameters(List<Map<String, Object>> comparisonParameters) {
        this.comparisonParameters = comparisonParameters;
    }

    public Map<String, Object> getSummaryResults() { return summaryResults; }
    public void setSummaryResults(Map<String, Object> summaryResults) {
        this.summaryResults = summaryResults;
    }

    public Instant getCreated() { return created; }
    public void setCreated(Instant created) { this.created = created; }

    public Instant getUpdated() { return updated; }
    public void setUpdated(Instant updated) { this.updated = updated; }

    public List<Result> getResults() { return results; }
    public void setResults(List<Result> results) { this.results = results; }
}


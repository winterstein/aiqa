package dev.aiqa.types;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

public class Metric {
    private String name;
    private String description;
    private String unit;
    private String type; // 'javascript' | 'llm' | 'number'
    private Map<String, Object> parameters;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getUnit() { return unit; }
    public void setUnit(String unit) { this.unit = unit; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public Map<String, Object> getParameters() { return parameters; }
    public void setParameters(Map<String, Object> parameters) { this.parameters = parameters; }
}


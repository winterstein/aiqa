package dev.aiqa;

import dev.aiqa.types.*;
import dev.aiqa.util.HttpClient;
import okhttp3.HttpUrl;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.*;
import java.util.function.BiFunction;
import java.util.function.Function;

/**
 * The ExperimentRunner is the main class for running experiments on datasets.
 * It can create an experiment, run it, and score the results.
 */
public class ExperimentRunner {
    private static final Logger logger = LoggerFactory.getLogger(ExperimentRunner.class);
    
    private final String datasetId;
    private final String organisation;
    private String experimentId;
    private Experiment experiment;
    private final HttpClient httpClient;

    public ExperimentRunner(String datasetId, String serverUrl, String apiKey, String organisationId) {
        this.datasetId = datasetId;
        String url = serverUrl != null ? serverUrl : System.getenv("AIQA_SERVER_URL");
        String key = apiKey != null ? apiKey : System.getenv("AIQA_API_KEY");
        this.organisation = organisationId;
        this.httpClient = new HttpClient(url, key);
    }

    /**
     * Fetch the dataset to get its metrics
     */
    public Dataset getDataset() throws IOException {
        return httpClient.get("/dataset/" + datasetId, Dataset.class);
    }

    /**
     * Fetch example inputs from the dataset
     */
    public List<Example> getExampleInputs(int limit) throws IOException {
        HttpUrl.Builder urlBuilder = httpClient.urlBuilder("/example")
                .addQueryParameter("dataset_id", datasetId)
                .addQueryParameter("limit", String.valueOf(limit));
        
        if (organisation != null) {
            urlBuilder.addQueryParameter("organisation", organisation);
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> data = httpClient.get(urlBuilder.build(), Map.class);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> hits = (List<Map<String, Object>>) data.get("hits");
        
        List<Example> examples = new ArrayList<>();
        if (hits != null) {
            for (Map<String, Object> hit : hits) {
                examples.add(httpClient.getObjectMapper().convertValue(hit, Example.class));
            }
        }
        return examples;
    }

    /**
     * Create an experiment if one does not exist.
     */
    public Experiment createExperiment(Map<String, Object> experimentSetup) throws IOException {
        if (organisation == null || datasetId == null) {
            throw new IllegalStateException("Organisation and dataset ID are required to create an experiment");
        }

        if (experimentSetup == null) {
            experimentSetup = new HashMap<>();
        }

        experimentSetup.put("organisation", organisation);
        experimentSetup.put("dataset", datasetId);
        experimentSetup.put("results", new ArrayList<>());
        experimentSetup.put("summary_results", new HashMap<>());

        logger.info("AIQA: Creating experiment");
        experiment = httpClient.post("/experiment", experimentSetup, Experiment.class);
        experimentId = experiment.getId();
        return experiment;
    }

    /**
     * Ask the server to score an example result.
     */
    public Map<String, Object> scoreAndStore(Example example, Object result, Map<String, Number> scores) 
            throws IOException {
        if (experimentId == null) {
            createExperiment(null);
        }

        logger.info("AIQA: Scoring and storing example: {}", example.getId());
        logger.info("AIQA: Scores: {}", scores);

        Map<String, Object> payload = new HashMap<>();
        payload.put("output", result);
        payload.put("traceId", example.getTraceId());
        payload.put("scores", scores != null ? scores : new HashMap<>());

        @SuppressWarnings("unchecked")
        Map<String, Object> jsonResult = httpClient.post(
                "/experiment/" + experimentId + "/example/" + example.getId() + "/scoreAndStore",
                payload, Map.class);
        logger.info("AIQA: scoreAndStore response: {}", jsonResult);
        return jsonResult;
    }

    /**
     * Run the engine on an example with the given parameters, and score the result.
     */
    public List<Map<String, Object>> runExample(
            Example example,
            Function<Object, Object> callMyCode,
            BiFunction<Object, Example, Map<String, Number>> scoreThisOutput) throws IOException {
        
        if (experiment == null) {
            createExperiment(null);
        }
        if (experiment == null) {
            throw new IllegalStateException("Failed to create experiment");
        }

        Map<String, Object> parametersFixed = experiment.getParameters() != null ? 
                experiment.getParameters() : new HashMap<>();
        List<Map<String, Object>> parametersLoop = experiment.getComparisonParameters() != null ? 
                experiment.getComparisonParameters() : Collections.singletonList(new HashMap<>());

        Object input = example.getInput();
        if (input == null && example.getSpans() != null && !example.getSpans().isEmpty()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> attributes = (Map<String, Object>) example.getSpans().get(0).get("attributes");
            if (attributes != null) {
                input = attributes.get("input");
            }
        }

        if (input == null) {
            logger.warn("AIQA: Example has no input field or spans with input attribute: {}", example);
        }

        List<Map<String, Object>> allScores = new ArrayList<>();

        for (Map<String, Object> parameters : parametersLoop) {
            Map<String, Object> parametersHere = new HashMap<>(parametersFixed);
            parametersHere.putAll(parameters);
            
            logger.info("AIQA: Running with parameters: {}", parametersHere);

            // Set environment variables from parameters
            for (Map.Entry<String, Object> entry : parametersHere.entrySet()) {
                if (entry.getValue() != null) {
                    System.setProperty(entry.getKey(), entry.getValue().toString());
                }
            }

            long start = System.currentTimeMillis();
            Object output = callMyCode.apply(input);
            long duration = System.currentTimeMillis() - start;

            logger.info("AIQA: Output: {}", output);

            Map<String, Number> scores = new HashMap<>();
            if (scoreThisOutput != null) {
                scores.putAll(scoreThisOutput.apply(output, example));
            }
            scores.put("duration", duration);

            logger.info("AIQA: Call scoreAndStore ... for example: {} with scores: {}", example.getId(), scores);
            Map<String, Object> result = scoreAndStore(example, output, scores);
            logger.info("AIQA: scoreAndStore returned: {}", result);
            allScores.add(result);
        }

        return allScores;
    }

    /**
     * Run an engine function on all examples and score the results
     */
    public void run(Function<Object, Object> engine, 
                    BiFunction<Object, Example, Map<String, Number>> scorer) throws IOException {
        List<Example> examples = getExampleInputs(10000);
        
        for (Example example : examples) {
            runExample(example, engine, scorer);
        }
    }

    /**
     * Get summary results from the experiment
     */
    public Map<String, Object> getSummaryResults() throws IOException {
        Experiment experiment2 = httpClient.get("/experiment/" + experimentId, Experiment.class);
        return experiment2.getSummaryResults() != null ? experiment2.getSummaryResults() : new HashMap<>();
    }
}


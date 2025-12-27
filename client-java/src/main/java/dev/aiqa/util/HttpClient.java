package dev.aiqa.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import okhttp3.*;

import java.io.IOException;

/**
 * Simple HTTP client utility for AIQA API requests
 */
public class HttpClient {
    private final OkHttpClient client;
    private final ObjectMapper objectMapper;
    private final String serverUrl;
    private final String apiKey;

    public HttpClient(String serverUrl, String apiKey) {
        this.serverUrl = serverUrl.replaceAll("/$", "");
        this.apiKey = apiKey;
        this.client = new OkHttpClient();
        this.objectMapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    public <T> T get(String path, Class<T> responseType) throws IOException {
        return get(HttpUrl.parse(serverUrl + path), responseType);
    }

    public <T> T get(HttpUrl url, Class<T> responseType) throws IOException {
        Request request = new Request.Builder()
                .url(url)
                .get()
                .addHeader("Content-Type", "application/json")
                .addHeader("Authorization", "ApiKey " + apiKey)
                .build();

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "Unknown error";
                throw new IOException("Request failed: " + response.code() + " " + 
                        response.message() + " - " + errorBody);
            }
            return objectMapper.readValue(response.body().string(), responseType);
        }
    }

    public <T> T post(String path, Object body, Class<T> responseType) throws IOException {
        String json = objectMapper.writeValueAsString(body);
        Request request = new Request.Builder()
                .url(serverUrl + path)
                .post(RequestBody.create(json, MediaType.parse("application/json")))
                .addHeader("Content-Type", "application/json")
                .addHeader("Authorization", "ApiKey " + apiKey)
                .build();

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "Unknown error";
                throw new IOException("Request failed: " + response.code() + " " + 
                        response.message() + " - " + errorBody);
            }
            return objectMapper.readValue(response.body().string(), responseType);
        }
    }

    public ObjectMapper getObjectMapper() {
        return objectMapper;
    }

    public HttpUrl.Builder urlBuilder(String path) {
        return HttpUrl.parse(serverUrl + path).newBuilder();
    }
}


package ru.kb911.generatorb3d;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class ModelsApi {
    final String base, token;
    ModelsApi(String base, String token) throws Exception {
        URL address = new URL(base);
        if (!address.getProtocol().equals("https") || address.getHost().isEmpty() || address.getUserInfo() != null || address.getQuery() != null || address.getRef() != null || !(address.getPath().isEmpty() || address.getPath().equals("/"))) throw new Exception("Укажите HTTPS-адрес сайта");
        this.base = base.replaceAll("/+$", ""); this.token = token;
        if (token.length() < 32 || token.contains("\n") || token.contains("\r")) throw new Exception("Введите ключ публикации в настройках");
    }
    static String enc(String text) throws Exception { return URLEncoder.encode(text, "UTF-8"); }
    JSONObject request(String method, String path, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setRequestMethod(method); connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(30000);
        connection.setRequestProperty("Authorization", "Bearer " + token); connection.setRequestProperty("Accept", "application/json");
        try {
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bytes.length); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (java.io.OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int code = connection.getResponseCode();
            if (code == 401) throw new Exception("Ключ не принят сервером. Проверьте настройки.");
            if (code < 200 || code >= 300) throw new Exception("Сервер вернул HTTP " + code + ". Повторите запрос позже.");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] bytes = new byte[8192]; int count;
                while ((count = in.read(bytes)) != -1) { if (output.size() + count > 2 * 1024 * 1024) throw new Exception("Ответ сервера слишком большой"); output.write(bytes, 0, count); }
            }
            JSONObject result = new JSONObject(output.toString("UTF-8"));
            if (!result.optBoolean("success")) throw new Exception(result.optString("error", "Запрос не выполнен"));
            return result;
        } finally { connection.disconnect(); }
    }
    List<JSONObject> list(String project) throws Exception {
        List<JSONObject> items = new ArrayList<>(); String cursor = ""; int pages = 0;
        do {
            if (++pages > 100) throw new Exception("Слишком много страниц в ответе сервера");
            String path = project == null ? "/api/models/projects?" : "/api/models/project?project=" + enc(project) + "&";
            if (!cursor.isEmpty()) path += "cursor=" + enc(cursor);
            JSONObject page = request("GET", path, null);
            JSONArray array = page.getJSONArray(project == null ? "projects" : "files");
            for (int i = 0; i < array.length(); i++) items.add(array.getJSONObject(i));
            cursor = page.isNull("cursor") ? "" : page.optString("cursor", "");
        } while (!cursor.isEmpty());
        return items;
    }
    void delete(List<JSONObject> files) throws Exception {
        JSONArray array = new JSONArray();
        for (JSONObject file : files) array.put(new JSONObject().put("project", file.getString("project")).put("model", file.getString("model")));
        request("DELETE", "/api/models/files", new JSONObject().put("files", array));
    }
    String modelURL(JSONObject file) throws Exception {
        java.net.URI actual = new URL(file.getString("url")).toURI();
        java.net.URI origin = new URL(base).toURI();
        String expectedPath = "/3d-temp/" + file.getString("project") + "/" + file.getString("model") + ".html";
        // Compare decoded paths: encodeURIComponent and URLEncoder treat
        // parentheses differently, and product names often contain '(4)'.
        if (!"https".equals(actual.getScheme()) || actual.getUserInfo() != null || actual.getQuery() != null || actual.getFragment() != null || !origin.getRawAuthority().equalsIgnoreCase(actual.getRawAuthority()) || !expectedPath.equals(actual.getPath())) throw new Exception("Некорректная ссылка на модель");
        return file.getString("url");
    }
}
